import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireCreatorId } from "./lib/auth";
import { fail } from "./lib/errors";
import { avatarUrl, NOTIFICATION_WINDOW_MS, rateLimit } from "./lib/social";

// "Creator went live" notifications. Ported from backend/internal/social
// (Notifications, MarkRead, PruneEvents).
//
// Nothing fans out when a creator goes live: there is one liveEvents row per
// show, and each viewer's query gathers events from the creators they follow
// (at most 1,000), at most 25 recent ones each, from the last 30 days and
// only since the follow began. Unfollowing removes them; re-following starts
// a new window. That gathering is the first thing to rework at very large
// scale (per-user inbox or read watermark), as in the Go API.

const PAGE = 24;
const PER_CREATOR = 25;
const UNREAD_CAP = 100;
/** Most read receipts checked when counting unread, to bound reads. */
const UNREAD_SCAN = 500;
const PRUNE_BATCH = 500;

type Candidate = { event: Doc<"liveEvents">; creator: Doc<"profiles"> };

async function visibleEvents(ctx: QueryCtx, userId: Id<"users">, now: number) {
  const follows = await ctx.db
    .query("follows")
    .withIndex("by_follower_creator", (q) => q.eq("followerId", userId))
    .collect();
  const candidates: Candidate[] = [];
  for (const follow of follows) {
    const creator = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", follow.creatorId))
      .first();
    if (!creator?.published) continue;
    const since = Math.max(follow._creationTime, now - NOTIFICATION_WINDOW_MS);
    const events = await ctx.db
      .query("liveEvents")
      .withIndex("by_creator", (q) =>
        q.eq("creatorId", follow.creatorId).gte("_creationTime", since),
      )
      .order("desc")
      .take(PER_CREATOR);
    for (const event of events) candidates.push({ event, creator });
  }
  return candidates.sort(
    (a, b) => b.event._creationTime - a.event._creationTime,
  );
}

function isRead(ctx: QueryCtx, userId: Id<"users">, eventId: Id<"liveEvents">) {
  return ctx.db
    .query("notificationReads")
    .withIndex("by_user_event", (q) =>
      q.eq("userId", userId).eq("eventId", eventId),
    )
    .first()
    .then((row) => row !== null);
}

/**
 * The signed-in user's notifications, newest first, 24 per page. Pass the
 * previous page's `before` to continue. Unread counts stop at 100
 * (unreadCapped), as the Go API's do.
 */
export const list = query({
  args: { before: v.optional(v.number()) },
  handler: async (ctx, { before }) => {
    const userId = await requireCreatorId(ctx);
    const all = await visibleEvents(ctx, userId, Date.now());
    const page = all
      .filter(
        ({ event }) => before === undefined || event._creationTime < before,
      )
      .slice(0, PAGE + 1);
    const items = await Promise.all(
      page.slice(0, PAGE).map(async ({ event, creator }) => ({
        _id: event._id,
        username: creator.username,
        displayName: creator.displayName,
        avatarUrl: await avatarUrl(ctx, creator),
        showId: event.showId,
        createdAt: event._creationTime,
        isLive: creator.isLive && creator.liveShowId === event.showId,
        read: await isRead(ctx, userId, event._id),
      })),
    );

    let unreadCount = 0;
    let scanned = 0;
    for (const { event } of all) {
      if (unreadCount >= UNREAD_CAP || scanned >= UNREAD_SCAN) break;
      scanned++;
      if (!(await isRead(ctx, userId, event._id))) unreadCount++;
    }
    return {
      items,
      before: page.length > PAGE ? items[PAGE - 1].createdAt : undefined,
      unreadCount,
      unreadCapped: unreadCount >= UNREAD_CAP || scanned >= UNREAD_SCAN,
    };
  },
});

/**
 * Marks notifications read. Only events the user can currently see (a
 * followed, published creator, within the window, after the follow) count;
 * anything else is ignored rather than revealing it exists.
 */
export const markRead = mutation({
  args: { ids: v.array(v.id("liveEvents")) },
  handler: async (ctx, { ids }) => {
    const userId = await requireCreatorId(ctx);
    if (ids.length < 1 || ids.length > 50) fail("VALIDATION_FAILED");
    await rateLimit(ctx, `reads:${userId}`, 120);
    const now = Date.now();
    for (const eventId of new Set(ids)) {
      const event = await ctx.db.get(eventId);
      if (!event || event._creationTime < now - NOTIFICATION_WINDOW_MS)
        continue;
      const follow = await ctx.db
        .query("follows")
        .withIndex("by_follower_creator", (q) =>
          q.eq("followerId", userId).eq("creatorId", event.creatorId),
        )
        .first();
      if (!follow || follow._creationTime > event._creationTime) continue;
      const creator = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", event.creatorId))
        .first();
      if (!creator?.published || (await isRead(ctx, userId, eventId))) continue;
      await ctx.db.insert("notificationReads", { userId, eventId });
    }
  },
});

/**
 * Deletes events older than 30 days with their read receipts, in batches
 * (crons.ts). A famous creator's event can have many receipts, so receipts
 * go first, a batch at a time, and the event only once it has none.
 * Queries already hide old events, so cleanup can lag safely.
 */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - NOTIFICATION_WINDOW_MS;
    const old = await ctx.db
      .query("liveEvents")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(50);
    let deleted = 0;
    for (const event of old) {
      const receipts = await ctx.db
        .query("notificationReads")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .take(PRUNE_BATCH - deleted);
      for (const receipt of receipts) await ctx.db.delete(receipt._id);
      deleted += receipts.length;
      if (deleted >= PRUNE_BATCH) break;
      await ctx.db.delete(event._id);
    }
    if (deleted >= PRUNE_BATCH || old.length === 50) {
      await ctx.scheduler.runAfter(0, internal.notifications.prune, {});
    }
  },
});
