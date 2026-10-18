import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireCreatorId } from "./lib/auth";
import {
  activeCallForShow,
  applyTransition,
  CONNECTABLE_STATUSES,
} from "./lib/calls";
import { fail } from "./lib/errors";
import { scheduleCancel } from "./lib/payments";
import {
  onShowCreated,
  onShowEnded,
  onShowLive,
  onShowScheduled,
} from "./lib/social";
import { accountReady } from "./payouts";

// Show lifecycle: CREATED → LIVE → ENDED. Ported from backend/internal/show.

/** Entries closed per batch when a show ends. Keeps each mutation small. */
const CLOSE_BATCH = 200;

const ACTIVE_ENTRY_STATUSES = [
  "WAITING",
  "SELECTED",
  "CONNECTING",
  "LIVE",
] as const;

export async function showForCreator(
  ctx: QueryCtx,
  showId: Id<"shows">,
  creatorId: Id<"users">,
): Promise<Doc<"shows">> {
  const show = await ctx.db.get(showId);
  if (!show || show.creatorId !== creatorId) fail("SHOW_NOT_FOUND");
  return show;
}

/** The creator's live show, or else their newest unstarted one. */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const creatorId = await requireCreatorId(ctx);
    const live = await ctx.db
      .query("shows")
      .withIndex("by_creator_status", (q) =>
        q.eq("creatorId", creatorId).eq("status", "LIVE"),
      )
      .first();
    if (live) return live;
    return ctx.db
      .query("shows")
      .withIndex("by_creator_status", (q) =>
        q.eq("creatorId", creatorId).eq("status", "CREATED"),
      )
      .order("desc")
      .first();
  },
});

/** A new show starts with one free Standard tier, as in the Go API. */
export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const creatorId = await requireCreatorId(ctx);
    const showId = await ctx.db.insert("shows", {
      creatorId,
      status: "CREATED",
    });
    await ctx.db.insert("showTiers", {
      showId,
      name: "Standard",
      priorityRank: 0,
      callDurationSeconds: 300,
      priceCents: 0,
      enabled: true,
    });
    await onShowCreated(ctx, creatorId);
    return showId;
  },
});

/** A schedule must be at least this far ahead, and at most this far. */
const SCHEDULE_MIN_LEAD_MS = 5 * 60_000;
const SCHEDULE_MAX_LEAD_MS = 60 * 24 * 60 * 60_000;

/**
 * Announces when a draft Hotline will open, or clears it (null). It's an
 * announcement, not a timer: the creator still opens the Hotline themselves,
 * since callers need them there. Going live clears it.
 */
export const schedule = mutation({
  args: { showId: v.id("shows"), scheduledFor: v.union(v.number(), v.null()) },
  handler: async (ctx, { showId, scheduledFor }) => {
    const creatorId = await requireCreatorId(ctx);
    const show = await showForCreator(ctx, showId, creatorId);
    if (show.status !== "CREATED") fail("INVALID_SHOW_STATE");
    if (scheduledFor !== null) {
      const lead = scheduledFor - Date.now();
      if (lead < SCHEDULE_MIN_LEAD_MS || lead > SCHEDULE_MAX_LEAD_MS) {
        fail("VALIDATION_FAILED");
      }
    }
    await ctx.db.patch(showId, { scheduledFor: scheduledFor ?? undefined });
    await onShowScheduled(ctx, creatorId, scheduledFor ?? undefined);
    return (await ctx.db.get(showId))!;
  },
});

export const start = mutation({
  args: { showId: v.id("shows") },
  handler: async (ctx, { showId }) => {
    const creatorId = await requireCreatorId(ctx);
    const show = await showForCreator(ctx, showId, creatorId);
    if (show.status === "LIVE") return show;
    if (show.status !== "CREATED") fail("INVALID_SHOW_STATE");

    const tiers = await ctx.db
      .query("showTiers")
      .withIndex("by_show_rank", (q) => q.eq("showId", showId))
      .collect();
    const enabled = tiers.filter((tier) => tier.enabled);
    if (enabled.length === 0) fail("INVALID_TIER_CONFIGURATION");
    // A paid show charges callers, so its creator must be able to receive
    // money first. Readiness is what payouts.status last read from Stripe;
    // the dashboard refreshes it before offering to start.
    if (enabled.some((tier) => tier.priceCents > 0)) {
      const account = await ctx.db
        .query("payoutAccounts")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .first();
      if (!accountReady(account)) fail("PAYOUT_SETUP_REQUIRED");
    }

    // One live show per creator. This read and the write below commit
    // together, so two starts racing cannot both succeed.
    const otherLive = await ctx.db
      .query("shows")
      .withIndex("by_creator_status", (q) =>
        q.eq("creatorId", creatorId).eq("status", "LIVE"),
      )
      .first();
    if (otherLive) fail("ACTIVE_SHOW_EXISTS");

    await ctx.db.patch(showId, { status: "LIVE", startedAt: Date.now() });
    const live = (await ctx.db.get(showId))!;
    await onShowLive(ctx, live);
    return live;
  },
});

export const end = mutation({
  args: { showId: v.id("shows") },
  handler: async (ctx, { showId }) => {
    const creatorId = await requireCreatorId(ctx);
    const show = await showForCreator(ctx, showId, creatorId);
    if (show.status === "ENDED") return show;
    if (show.status !== "LIVE") fail("INVALID_SHOW_STATE");

    await ctx.db.patch(showId, { status: "ENDED", endedAt: Date.now() });
    await onShowEnded(ctx, show);
    // An open call ends with its show; a paid one that never went live is
    // refunded. A call still capturing payment is settled when the capture
    // finishes (lib/payments.recordCaptured refunds it, as the show ended).
    const call = await activeCallForShow(ctx, showId);
    if (call && CONNECTABLE_STATUSES.includes(call.status)) {
      await applyTransition(ctx, call, "ENDED");
    }
    // Joins check that the show is LIVE, so no new entries appear from here.
    // Closing the existing ones runs in batches so a huge queue never hits a
    // single mutation's write limit.
    await ctx.scheduler.runAfter(0, internal.shows.closeQueue, { showId });
    return (await ctx.db.get(showId))!;
  },
});

export const closeQueue = internalMutation({
  args: { showId: v.id("shows") },
  handler: async (ctx, { showId }) => {
    const closed = await closeEntries(ctx, showId, CLOSE_BATCH);
    if (closed === CLOSE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.shows.closeQueue, { showId });
    }
  },
});

async function closeEntries(
  ctx: MutationCtx,
  showId: Id<"shows">,
  limit: number,
): Promise<number> {
  let closed = 0;
  const now = Date.now();
  for (const status of ACTIVE_ENTRY_STATUSES) {
    if (closed >= limit) break;
    const entries = await ctx.db
      .query("queueEntries")
      .withIndex("by_show_status_rank_joined", (q) =>
        q.eq("showId", showId).eq("status", status),
      )
      .take(limit - closed);
    for (const entry of entries) {
      await ctx.db.patch(entry._id, { status: "ENDED", leftAt: now });
      // Callers still waiting when the show ends get their card hold back
      // now rather than when it lapses days later.
      if (status === "WAITING" && entry.paymentAttemptId) {
        const attempt = await ctx.db.get(entry.paymentAttemptId);
        if (attempt) await scheduleCancel(ctx, attempt, "show_ended");
      }
    }
    closed += entries.length;
  }
  return closed;
}

/** Public: the creator's live show, for their Hotline page. */
export const liveByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const creator = await ctx.db
      .query("users")
      .withIndex("by_username", (q) =>
        q.eq("username", username.trim().toLowerCase()),
      )
      .first();
    if (!creator) return null;
    const show = await ctx.db
      .query("shows")
      .withIndex("by_creator_status", (q) =>
        q.eq("creatorId", creator._id).eq("status", "LIVE"),
      )
      .first();
    if (!show) return null;
    return { _id: show._id, status: show.status, startedAt: show.startedAt };
  },
});
