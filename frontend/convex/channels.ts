import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { fail } from "./lib/errors";
import {
  profileByUsername,
  VISITOR_COUNT_INTERVAL_MS,
  VISITOR_TTL_MS,
} from "./lib/social";

// Approximate "people on this channel page" counts for live shows. Ported
// from the Go API's Redis sorted-set presence.
//
// A visitor's heartbeat (every 30 seconds while the page is visible) writes
// only their own row. A per-show job recounts recent visitors every
// VISITOR_COUNT_INTERVAL_MS while anyone is visiting and stores the total in
// channelStats, which is what profiles show. Recounting per heartbeat would
// re-run every visitor's query on every heartbeat.
//
// Like the Go version this is an activity indicator, not an audience
// measure: separate browsers count separately and it is not abuse-proof.

const MIN_HEARTBEAT_GAP_MS = 10_000;
const COUNT_PAGE = 1000;

export const heartbeat = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const visitorId = await requireUserId(ctx);
    const profile = await profileByUsername(ctx, username);
    const showId =
      profile?.published && profile.isLive ? profile.liveShowId : undefined;
    if (!showId) fail("SHOW_NOT_LIVE");
    const now = Date.now();
    const visit = await ctx.db
      .query("channelVisits")
      .withIndex("by_show_visitor", (q) =>
        q.eq("showId", showId).eq("visitorId", visitorId),
      )
      .first();
    // Extra tabs and fast reloads do not cost a write.
    if (!visit) {
      await ctx.db.insert("channelVisits", {
        showId,
        visitorId,
        lastSeenAt: now,
      });
    } else if (now - visit.lastSeenAt >= MIN_HEARTBEAT_GAP_MS) {
      await ctx.db.patch(visit._id, { lastSeenAt: now });
    }
    // The first visitor after a quiet spell starts the recounting.
    const stats = await ctx.db
      .query("channelStats")
      .withIndex("by_show", (q) => q.eq("showId", showId))
      .first();
    if (!stats?.counting) {
      if (stats) await ctx.db.patch(stats._id, { counting: true });
      else
        await ctx.db.insert("channelStats", {
          showId,
          visitors: 1,
          counting: true,
        });
      await ctx.scheduler.runAfter(0, internal.channels.countVisitors, {
        showId,
      });
    }
    return { expiresInSeconds: VISITOR_TTL_MS / 1000 };
  },
});

/**
 * Recounts a live show's recent visitors, then runs again after the
 * interval; stops once the show is no longer live. Counting happens in
 * read-only queries (a consistent snapshot that never conflicts with
 * heartbeats), a page at a time; only the total is written.
 */
export const countVisitors = internalAction({
  args: { showId: v.id("shows") },
  handler: async (ctx, { showId }) => {
    const since = Date.now() - VISITOR_TTL_MS;
    let cursor: string | null = null;
    let total = 0;
    for (;;) {
      const page: { count: number; continueCursor: string; isDone: boolean } =
        await ctx.runQuery(internal.channels.countPage, {
          showId,
          since,
          cursor,
        });
      total += page.count;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    await ctx.runMutation(internal.channels.storeCount, {
      showId,
      visitors: total,
      since,
    });
  },
});

export const countPage = internalQuery({
  args: {
    showId: v.id("shows"),
    since: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { showId, since, cursor }) => {
    const page = await ctx.db
      .query("channelVisits")
      .withIndex("by_show_seen", (q) =>
        q.eq("showId", showId).gt("lastSeenAt", since),
      )
      .paginate({ numItems: COUNT_PAGE, cursor });
    return {
      count: page.page.length,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const storeCount = internalMutation({
  args: { showId: v.id("shows"), visitors: v.number(), since: v.number() },
  handler: async (ctx, { showId, visitors, since }) => {
    const show = await ctx.db.get(showId);
    const stats = await ctx.db
      .query("channelStats")
      .withIndex("by_show", (q) => q.eq("showId", showId))
      .first();
    const live = show?.status === "LIVE";
    // Keep counting while anyone is here; the next heartbeat restarts it.
    const counting = live && visitors > 0;
    if (live) {
      if (!stats)
        await ctx.db.insert("channelStats", { showId, visitors, counting });
      else if (stats.visitors !== visitors || stats.counting !== counting) {
        await ctx.db.patch(stats._id, { visitors, counting });
      }
    } else if (stats) {
      await ctx.db.delete(stats._id);
    }
    // Expired visits (all of them once the show is over), a batch per run.
    const expired = await ctx.db
      .query("channelVisits")
      .withIndex("by_show_seen", (q) =>
        live
          ? q.eq("showId", showId).lte("lastSeenAt", since)
          : q.eq("showId", showId),
      )
      .take(COUNT_PAGE);
    for (const visit of expired) await ctx.db.delete(visit._id);
    if (counting || expired.length === COUNT_PAGE) {
      await ctx.scheduler.runAfter(
        counting ? VISITOR_COUNT_INTERVAL_MS : 0,
        internal.channels.countVisitors,
        { showId },
      );
    }
  },
});
