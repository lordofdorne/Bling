import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
} from "./_generated/server";
import {
  applyTransition,
  CONNECTABLE_STATUSES,
  callForParticipant,
  DISCONNECT_GRACE_MS,
  PRESENCE_TTL_MS,
  type Role,
} from "./lib/calls";
import { fail } from "./lib/errors";
import { callRole } from "./schema";

// Call presence, replacing the Go API's Redis leases and disconnect worker.
//
// Each participant on a call page sends a heartbeat every HEARTBEAT_MS. Every
// heartbeat schedules a check for PRESENCE_TTL_MS later; if no newer heartbeat
// has arrived by then, the participant is marked disconnected and a second
// check runs after DISCONNECT_GRACE_MS. Still disconnected then, the call
// fails. Nothing polls: with no calls, nothing runs.
//
// Only participants who have connected can be disconnected, as in the Go API.

export const heartbeat = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const { call, role } = await callForParticipant(ctx, callId);
    if (!CONNECTABLE_STATUSES.includes(call.status)) fail("CALL_NOT_FOUND");
    const now = Date.now();
    const row = await presenceRow(ctx, callId, role);
    if (row) {
      await ctx.db.patch(row._id, {
        lastSeenAt: now,
        disconnectedAt: undefined,
      });
    } else {
      await ctx.db.insert("callPresence", { callId, role, lastSeenAt: now });
    }
    await ctx.scheduler.runAfter(PRESENCE_TTL_MS, internal.presence.checkSeen, {
      callId,
      role,
      seenAt: now,
    });
  },
});

/** Sent when a participant leaves the call page, so the grace starts now. */
export const leave = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const { call, role } = await callForParticipant(ctx, callId);
    if (!CONNECTABLE_STATUSES.includes(call.status)) return;
    const row = await presenceRow(ctx, callId, role);
    if (row && row.disconnectedAt === undefined) {
      await markDisconnected(ctx, row._id, callId, role);
    }
  },
});

export const checkSeen = internalMutation({
  args: { callId: v.id("calls"), role: callRole, seenAt: v.number() },
  handler: async (ctx, { callId, role, seenAt }) => {
    const row = await presenceRow(ctx, callId, role);
    // A newer heartbeat (or a finished call, which deletes presence) wins.
    if (!row || row.lastSeenAt !== seenAt || row.disconnectedAt !== undefined) {
      return;
    }
    await markDisconnected(ctx, row._id, callId, role);
  },
});

export const checkGrace = internalMutation({
  args: { callId: v.id("calls"), role: callRole, disconnectedAt: v.number() },
  handler: async (ctx, { callId, role, disconnectedAt }) => {
    const row = await presenceRow(ctx, callId, role);
    if (row?.disconnectedAt !== disconnectedAt) return;
    const call = await ctx.db.get(callId);
    if (call && CONNECTABLE_STATUSES.includes(call.status)) {
      await applyTransition(ctx, call, "FAILED");
    }
  },
});

async function markDisconnected(
  ctx: MutationCtx,
  rowId: Id<"callPresence">,
  callId: Id<"calls">,
  role: Role,
) {
  const disconnectedAt = Date.now();
  await ctx.db.patch(rowId, { disconnectedAt });
  await ctx.scheduler.runAfter(
    DISCONNECT_GRACE_MS,
    internal.presence.checkGrace,
    { callId, role, disconnectedAt },
  );
}

function presenceRow(ctx: MutationCtx, callId: Id<"calls">, role: Role) {
  return ctx.db
    .query("callPresence")
    .withIndex("by_call_role", (q) => q.eq("callId", callId).eq("role", role))
    .first();
}
