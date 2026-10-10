import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  CONNECTABLE_STATUSES,
  callForParticipant,
  type Role,
} from "./lib/calls";
import { fail } from "./lib/errors";
import { signalType } from "./schema";

// WebRTC signaling over Convex, replacing the Go API's call WebSocket.
//
// The sender inserts signals addressed to the other participant. The
// recipient's inbox query updates as soon as they commit; the recipient
// handles them in order and deletes them with ack. Nothing else reads them,
// and they are purged when the call finishes.
//
// Who may send what matches the Go API: the creator offers, the caller
// answers and announces it is ready, both send ICE candidates.

const ALLOWED: Record<Role, readonly Doc<"callSignals">["type"][]> = {
  creator: ["signal.offer", "signal.ice"],
  viewer: ["signal.ready", "signal.answer", "signal.ice"],
};

/** Matches the Go API's 64 KB WebSocket read limit. */
const MAX_PAYLOAD_BYTES = 64 * 1024;
/** Signals per send. Clients batch ICE candidates to cut round trips. */
const MAX_BATCH = 20;
const PURGE_BATCH = 500;

const encoder = new TextEncoder();

export const send = mutation({
  args: {
    callId: v.id("calls"),
    signals: v.array(v.object({ type: signalType, payload: v.string() })),
  },
  handler: async (ctx, { callId, signals }) => {
    const { call, role } = await callForParticipant(ctx, callId);
    if (!CONNECTABLE_STATUSES.includes(call.status)) fail("CALL_NOT_FOUND");
    if (signals.length < 1 || signals.length > MAX_BATCH) {
      fail("INVALID_SIGNAL");
    }
    const to: Role = role === "creator" ? "viewer" : "creator";

    // Sends deliberately read nothing from the recipient's inbox (no pending
    // count, no scan): the recipient deletes from it as it acknowledges, and
    // any overlap would make sends and acks conflict and retry mid-handshake.
    // A participant can only flood their own call, which ends on time and is
    // purged.
    let readyPending: boolean | undefined;
    for (const signal of signals) {
      if (!ALLOWED[role].includes(signal.type)) fail("INVALID_SIGNAL");
      if (encoder.encode(signal.payload).length > MAX_PAYLOAD_BYTES) {
        fail("INVALID_SIGNAL");
      }
      try {
        JSON.parse(signal.payload);
      } catch {
        fail("INVALID_SIGNAL");
      }
      // The caller repeats "ready" until it gets an offer. One unhandled
      // ready is enough, so repeats are dropped rather than piling up.
      if (signal.type === "signal.ready") {
        readyPending ??=
          (await ctx.db
            .query("callSignals")
            .withIndex("by_call_to_type", (q) =>
              q.eq("callId", callId).eq("to", to).eq("type", "signal.ready"),
            )
            .first()) !== null;
        if (readyPending) continue;
        readyPending = true;
      }
      await ctx.db.insert("callSignals", { callId, to, ...signal });
    }
  },
});

/** Signals waiting for the signed-in participant, oldest first. */
export const inbox = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const { role } = await callForParticipant(ctx, callId);
    const signals = await ctx.db
      .query("callSignals")
      .withIndex("by_call_to_type", (q) =>
        q.eq("callId", callId).eq("to", role),
      )
      .collect();
    return signals
      .sort((a, b) => a._creationTime - b._creationTime)
      .map(({ _id, type, payload }) => ({ _id, type, payload }));
  },
});

/** Deletes signals the recipient has handled. */
export const ack = mutation({
  args: { callId: v.id("calls"), ids: v.array(v.id("callSignals")) },
  handler: async (ctx, { callId, ids }) => {
    const { role } = await callForParticipant(ctx, callId);
    for (const id of ids) {
      const signal = await ctx.db.get(id);
      if (signal?.callId === callId && signal.to === role) {
        await ctx.db.delete(id);
      }
    }
  },
});

/** Removes a finished call's leftover signals, in batches. */
export const purge = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const leftovers = await ctx.db
      .query("callSignals")
      .withIndex("by_call_to_type", (q) => q.eq("callId", callId))
      .take(PURGE_BATCH);
    for (const signal of leftovers) await ctx.db.delete(signal._id);
    if (leftovers.length === PURGE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.signals.purge, { callId });
    }
  },
});
