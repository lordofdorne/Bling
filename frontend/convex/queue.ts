import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { requireCreatorId, requireUserId } from "./lib/auth";
import { fail } from "./lib/errors";
import { scheduleCancel } from "./lib/payments";
import { verifyAuthorization } from "./payments";
import { showForCreator } from "./shows";

// The caller queue. Ported from backend/internal/queue.
//
// The queue is a holding place, not a line: creators choose whom to connect,
// so callers never see a position and nothing here computes one.
//
// Built for busy shows: join and leave read the show and tier (which do not
// change while a show is live) and write only the caller's own entry. Two
// callers joining at once touch different documents and never conflict.

/** Most entries a creator's list returns at once. */
const CREATOR_LIST_LIMIT = 200;

/** Past calls counted per caller; the list shows "10+" beyond this. */
const PAST_CALLS_COUNTED = 10;

function publicEntry(entry: Doc<"queueEntries">) {
  return {
    _id: entry._id,
    showId: entry.showId,
    displayName: entry.displayName,
    topic: entry.topic,
    status: entry.status,
    tierId: entry.tierId,
    tierName: entry.tierName,
    priorityRank: entry.priorityRank,
    callDurationSeconds: entry.callDurationSeconds,
    tierPriceCents: entry.tierPriceCents,
    joinedAt: entry.joinedAt,
    selectedAt: entry.selectedAt,
    leftAt: entry.leftAt,
  };
}

const joinArgs = {
  showId: v.id("shows"),
  tierId: v.optional(v.id("showTiers")),
  displayName: v.string(),
  topic: v.string(),
};

/** Joins a free tier. Paid tiers go through joinPaid. */
export const join = mutation({
  args: joinArgs,
  handler: async (ctx, args) => {
    const viewerId = await requireUserId(ctx);
    return publicEntry(await joinQueue(ctx, viewerId, args));
  },
});

/**
 * Joins a paid tier with a payment the caller authorized through
 * payments.authorize. Stripe is asked to confirm the hold first, unless a
 * webhook already did.
 */
export const joinPaid = action({
  args: { ...joinArgs, paymentAttemptId: v.id("paymentAttempts") },
  handler: async (ctx, args): Promise<ReturnType<typeof publicEntry>> => {
    await verifyAuthorization(ctx, args.showId, args.paymentAttemptId);
    return ctx.runMutation(internal.queue.joinWithPayment, args);
  },
});

export const joinWithPayment = internalMutation({
  args: { ...joinArgs, paymentAttemptId: v.id("paymentAttempts") },
  handler: async (ctx, { paymentAttemptId, ...args }) => {
    const viewerId = await requireUserId(ctx);
    return publicEntry(await joinQueue(ctx, viewerId, args, paymentAttemptId));
  },
});

async function joinQueue(
  ctx: MutationCtx,
  viewerId: Id<"users">,
  args: {
    showId: Id<"shows">;
    tierId?: Id<"showTiers">;
    displayName: string;
    topic: string;
  },
  paymentAttemptId?: Id<"paymentAttempts">,
): Promise<Doc<"queueEntries">> {
  const displayName = args.displayName.trim();
  const topic = args.topic.trim();
  if (displayName.length < 1 || displayName.length > 60) {
    fail("VALIDATION_FAILED", "Display name must be 1-60 characters.");
  }
  if (topic.length < 1 || topic.length > 280) {
    fail("VALIDATION_FAILED", "Topic must be 1-280 characters.");
  }

  const show = await ctx.db.get(args.showId);
  if (!show || show.status !== "LIVE") fail("SHOW_NOT_LIVE");

  const tier = args.tierId
    ? await ctx.db.get(args.tierId)
    : await ctx.db
        .query("showTiers")
        .withIndex("by_show_rank", (q) => q.eq("showId", args.showId))
        .order("desc")
        .filter((q) => q.eq(q.field("enabled"), true))
        .first();
  if (!tier || tier.showId !== args.showId || !tier.enabled) {
    fail("TIER_NOT_FOUND");
  }

  // Joining is idempotent per caller: a retry or a second tab returns the
  // same entry rather than adding another.
  const existing = await ctx.db
    .query("queueEntries")
    .withIndex("by_show_viewer", (q) =>
      q.eq("showId", args.showId).eq("viewerId", viewerId),
    )
    .first();
  if (existing && existing.status !== "LEFT") return existing;

  // A paid tier needs the caller's own authorized hold for exactly this
  // tier's price, not yet used by another queue entry.
  let attempt: Doc<"paymentAttempts"> | null = null;
  if (tier.priceCents > 0) {
    attempt = paymentAttemptId ? await ctx.db.get(paymentAttemptId) : null;
    const usable =
      attempt?.payerId === viewerId &&
      attempt.showId === args.showId &&
      attempt.tierId === tier._id &&
      attempt.amountCents === tier.priceCents &&
      attempt.status === "AUTHORIZED" &&
      (attempt.queueEntryId === undefined ||
        attempt.queueEntryId === existing?._id);
    if (!usable) fail("PAYMENT_REQUIRED");
  }

  const fields = {
    displayName,
    topic,
    status: "WAITING" as const,
    tierId: tier._id,
    tierName: tier.name,
    priorityRank: tier.priorityRank,
    callDurationSeconds: tier.callDurationSeconds,
    tierPriceCents: tier.priceCents,
    joinedAt: Date.now(),
    paymentAttemptId: attempt?._id,
  };
  let entryId = existing?._id;
  if (entryId) {
    await ctx.db.patch(entryId, { ...fields, leftAt: undefined });
  } else {
    entryId = await ctx.db.insert("queueEntries", {
      showId: args.showId,
      viewerId,
      ...fields,
    });
  }
  if (attempt) await ctx.db.patch(attempt._id, { queueEntryId: entryId });
  return (await ctx.db.get(entryId))!;
}

export const leave = mutation({
  args: { showId: v.id("shows") },
  handler: async (ctx, { showId }) => {
    const viewerId = await requireUserId(ctx);
    const entry = await ctx.db
      .query("queueEntries")
      .withIndex("by_show_viewer", (q) =>
        q.eq("showId", showId).eq("viewerId", viewerId),
      )
      .first();
    if (!entry) fail("NOT_IN_QUEUE");
    if (entry.status === "LEFT") return publicEntry(entry);
    if (entry.status !== "WAITING") fail("INVALID_QUEUE_STATE");
    await ctx.db.patch(entry._id, { status: "LEFT", leftAt: Date.now() });
    // Leaving releases the caller's card hold.
    const attempt =
      entry.paymentAttemptId && (await ctx.db.get(entry.paymentAttemptId));
    if (attempt) await scheduleCancel(ctx, attempt, "caller_left");
    return publicEntry((await ctx.db.get(entry._id))!);
  },
});

/** The caller's own request for a show, or null. Never a position. */
export const mine = query({
  args: { showId: v.id("shows") },
  handler: async (ctx, { showId }) => {
    const viewerId = await requireUserId(ctx);
    const entry = await ctx.db
      .query("queueEntries")
      .withIndex("by_show_viewer", (q) =>
        q.eq("showId", showId).eq("viewerId", viewerId),
      )
      .first();
    return entry ? publicEntry(entry) : null;
  },
});

/**
 * The creator's waiting callers, grouped by tier (highest priority first) and
 * by join time within a tier. The order is only for display; the creator
 * picks anyone.
 */
export const waiting = query({
  args: { showId: v.id("shows") },
  handler: async (ctx, { showId }) => {
    const creatorId = await requireCreatorId(ctx);
    await showForCreator(ctx, showId, creatorId);
    const tiers = await ctx.db
      .query("showTiers")
      .withIndex("by_show_rank", (q) => q.eq("showId", showId))
      .order("desc")
      .collect();
    const ranks = [...new Set(tiers.map((tier) => tier.priorityRank))];

    const entries: Doc<"queueEntries">[] = [];
    for (const rank of ranks) {
      const remaining = CREATOR_LIST_LIMIT - entries.length;
      if (remaining <= 0) break;
      entries.push(
        ...(await ctx.db
          .query("queueEntries")
          .withIndex("by_show_status_rank_joined", (q) =>
            q
              .eq("showId", showId)
              .eq("status", "WAITING")
              .eq("priorityRank", rank),
          )
          .take(remaining)),
      );
    }
    return Promise.all(
      entries.map(async (entry) => ({
        ...publicEntry(entry),
        caller: await callerInsight(ctx, creatorId, entry.viewerId),
      })),
    );
  },
});

/**
 * What the creator knows about one caller: whether they follow, how many
 * calls with this creator went live, and the creator's private note. Only the
 * creator's list carries this; a caller's own entry never does.
 */
async function callerInsight(
  ctx: QueryCtx,
  creatorId: Id<"users">,
  viewerId: Id<"users">,
) {
  const [follow, calls, note] = await Promise.all([
    ctx.db
      .query("follows")
      .withIndex("by_follower_creator", (q) =>
        q.eq("followerId", viewerId).eq("creatorId", creatorId),
      )
      .first(),
    ctx.db
      .query("calls")
      .withIndex("by_creator_viewer", (q) =>
        q.eq("creatorId", creatorId).eq("viewerId", viewerId),
      )
      .filter((q) => q.neq(q.field("startedAt"), undefined))
      .take(PAST_CALLS_COUNTED),
    ctx.db
      .query("callerNotes")
      .withIndex("by_creator_viewer", (q) =>
        q.eq("creatorId", creatorId).eq("viewerId", viewerId),
      )
      .first(),
  ]);
  return {
    follower: follow !== null,
    pastCalls: calls.length,
    note: note?.note ?? "",
  };
}
