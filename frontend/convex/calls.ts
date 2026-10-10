import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  query,
} from "./_generated/server";
import { requireCreatorId, requireUserId } from "./lib/auth";
import {
  activeCallForShow,
  applyTransition,
  type CallStatus,
  callForParticipant,
  withCaller,
} from "./lib/calls";
import { fail } from "./lib/errors";
import { showForCreator } from "./shows";

// Choosing a caller and the call lifecycle. Ported from backend/internal/call.
//
// The creator picks who to talk to: a specific caller, or a random caller
// from the highest tier that has anyone waiting. There is no "next in line".

/** The creator connects to a caller they chose. */
export const select = mutation({
  args: { showId: v.id("shows"), entryId: v.id("queueEntries") },
  handler: async (ctx, { showId, entryId }) => {
    const { show } = await prepareSelection(ctx, showId);
    const entry = await ctx.db.get(entryId);
    if (!entry || entry.showId !== showId || entry.status !== "WAITING") {
      fail("CALLER_NOT_WAITING");
    }
    return createCall(ctx, show, entry, "MANUAL");
  },
});

/**
 * The creator connects to a random caller from the highest tier with anyone
 * waiting.
 *
 * Reads stay small however long the queue is: one entry at each end of the
 * tier fixes the join-time range, a random point in it is chosen, and the
 * first caller at or after that point is taken. Reading the whole tier would
 * make this mutation conflict with every caller joining it.
 */
export const selectRandom = mutation({
  args: { showId: v.id("shows") },
  handler: async (ctx, { showId }) => {
    const { show } = await prepareSelection(ctx, showId);
    const tiers = await ctx.db
      .query("showTiers")
      .withIndex("by_show_rank", (q) => q.eq("showId", showId))
      .order("desc")
      .collect();
    for (const rank of new Set(tiers.map((tier) => tier.priorityRank))) {
      const waiting = () =>
        ctx.db
          .query("queueEntries")
          .withIndex("by_show_status_rank_joined", (q) =>
            q
              .eq("showId", showId)
              .eq("status", "WAITING")
              .eq("priorityRank", rank),
          );
      const first = await waiting().first();
      if (!first) continue;
      const last = (await waiting().order("desc").first())!;
      const pivot =
        first.joinedAt + Math.random() * (last.joinedAt - first.joinedAt);
      const chosen = await ctx.db
        .query("queueEntries")
        .withIndex("by_show_status_rank_joined", (q) =>
          q
            .eq("showId", showId)
            .eq("status", "WAITING")
            .eq("priorityRank", rank)
            .gte("joinedAt", pivot),
        )
        .first();
      return createCall(ctx, show, chosen ?? last, "RANDOM");
    }
    fail("QUEUE_EMPTY");
  },
});

async function prepareSelection(ctx: MutationCtx, showId: Id<"shows">) {
  const creatorId = await requireCreatorId(ctx);
  const show = await showForCreator(ctx, showId, creatorId);
  if (show.status !== "LIVE") fail("SHOW_NOT_LIVE");
  if (await activeCallForShow(ctx, showId)) fail("ACTIVE_CALL_EXISTS");
  return { show };
}

async function createCall(
  ctx: MutationCtx,
  show: Doc<"shows">,
  entry: Doc<"queueEntries">,
  selectionMode: "MANUAL" | "RANDOM",
) {
  // A paid caller's hold is captured before the call opens. The call waits
  // in PAYMENT_PENDING (the creator sees it, the caller does not) while
  // payments.capture runs; it then opens, or fails and releases the caller.
  // The entry is SELECTED straight away so the caller cannot leave mid-capture.
  const paid = entry.tierPriceCents > 0;
  const attempt =
    paid && entry.paymentAttemptId
      ? await ctx.db.get(entry.paymentAttemptId)
      : null;
  if (paid && attempt?.status !== "AUTHORIZED") fail("PAYMENT_CAPTURE_FAILED");

  await ctx.db.patch(entry._id, {
    status: "SELECTED",
    selectedAt: Date.now(),
  });
  const callId = await ctx.db.insert("calls", {
    showId: show._id,
    queueEntryId: entry._id,
    creatorId: show.creatorId,
    viewerId: entry.viewerId,
    status: paid ? "PAYMENT_PENDING" : "CREATED",
    selectionMode,
    callDurationSeconds: entry.callDurationSeconds,
    paymentAttemptId: attempt?._id,
  });
  if (attempt) {
    await ctx.db.patch(attempt._id, { status: "CAPTURING" });
    await ctx.scheduler.runAfter(0, internal.payments.capture, { callId });
  }
  return withCaller(ctx, (await ctx.db.get(callId))!);
}

/**
 * The creator's open call for a show, with the caller's details. Includes a
 * paid call still in PAYMENT_PENDING, so the creator sees it being charged.
 */
export const active = query({
  args: { showId: v.id("shows") },
  handler: async (ctx, { showId }) => {
    const creatorId = await requireCreatorId(ctx);
    await showForCreator(ctx, showId, creatorId);
    const call = await activeCallForShow(ctx, showId);
    return call ? withCaller(ctx, call) : null;
  },
});

/** The caller's most recent call on a show, or null. */
export const mine = query({
  args: { showId: v.id("shows") },
  handler: async (ctx, { showId }) => {
    const viewerId = await requireUserId(ctx);
    const calls = ctx.db
      .query("calls")
      .withIndex("by_viewer_show", (q) =>
        q.eq("viewerId", viewerId).eq("showId", showId),
      )
      .order("desc");
    for await (const call of calls) {
      if (call.status !== "PAYMENT_PENDING") return withCaller(ctx, call);
    }
    return null;
  },
});

/**
 * Moves a call forward. The creator may set CONNECTING, LIVE, ENDED or
 * FAILED; the caller may set LIVE, ENDED or FAILED.
 */
export const transition = mutation({
  args: {
    callId: v.id("calls"),
    status: v.union(
      v.literal("CONNECTING"),
      v.literal("LIVE"),
      v.literal("ENDED"),
      v.literal("FAILED"),
    ),
  },
  handler: async (ctx, { callId, status }) => {
    const { call, role } = await callForParticipant(ctx, callId);
    const allowed: readonly CallStatus[] =
      role === "creator"
        ? ["CONNECTING", "LIVE", "ENDED", "FAILED"]
        : ["LIVE", "ENDED", "FAILED"];
    if (!allowed.includes(status)) fail("INVALID_CALL_STATE");
    return withCaller(ctx, await applyTransition(ctx, call, status));
  },
});

/** Scheduled for a call's expiresAt when it goes LIVE. */
export const expire = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const call = await ctx.db.get(callId);
    if (call?.status !== "LIVE" || (call.expiresAt ?? 0) > Date.now()) return;
    await applyTransition(ctx, call, "ENDED");
  },
});
