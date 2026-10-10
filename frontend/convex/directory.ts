import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireCreatorId } from "./lib/auth";
import { fail } from "./lib/errors";
import { publicProfile } from "./lib/social";

// Discovery. Ported from backend/internal/social (List).
//
// Creators are ranked live first, then by follower count. The main listing
// pages through the by_directory index, so it never reads more than a page.
// Search and the following list rank a bounded candidate set in memory:
// Convex search orders by relevance, not by followers, and a user follows at
// most 1,000 creators.

const SEARCH_CANDIDATES = 256;
const MAX_QUERY = 80;

/** Live creators first, then the most followed, among published profiles. */
export const list = query({
  args: {
    live: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { live, paginationOpts }) => {
    if (paginationOpts.numItems < 1 || paginationOpts.numItems > 50) {
      fail("VALIDATION_FAILED", "Ask for 1 to 50 creators.");
    }
    const viewerId = await getAuthUserId(ctx);
    const page = await ctx.db
      .query("profiles")
      .withIndex("by_directory", (q) =>
        live
          ? q.eq("published", true).eq("isLive", true)
          : q.eq("published", true),
      )
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map((profile) => publicProfile(ctx, profile, viewerId)),
      ),
    };
  },
});

const rank = (a: Doc<"profiles">, b: Doc<"profiles">) =>
  Number(b.isLive) - Number(a.isLive) || b.followerCount - a.followerCount;

/**
 * Full-text search over username, display name and bio. Matches whole words
 * and, for the last word, prefixes (so "ali" finds "alice"), which the Go
 * API's Postgres search did not. Results are ranked like the directory.
 */
export const search = query({
  args: {
    query: v.string(),
    live: v.optional(v.boolean()),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const text = args.query.trim();
    const limit = args.limit ?? 24;
    const offset = args.offset ?? 0;
    if ([...text].length > MAX_QUERY || limit < 1 || limit > 50 || offset < 0) {
      fail("VALIDATION_FAILED", "Search terms are too long.");
    }
    if (!text) return { items: [], nextOffset: undefined };
    const viewerId = await getAuthUserId(ctx);
    const matches = await ctx.db
      .query("profiles")
      .withSearchIndex("search", (q) => {
        const base = q.search("searchText", text).eq("published", true);
        return args.live ? base.eq("isLive", true) : base;
      })
      .take(SEARCH_CANDIDATES);
    const ranked = matches.sort(rank).slice(offset, offset + limit);
    return {
      items: await Promise.all(
        ranked.map((profile) => publicProfile(ctx, profile, viewerId)),
      ),
      nextOffset: offset + limit < matches.length ? offset + limit : undefined,
    };
  },
});

/** Creators the signed-in user follows, ranked like the directory. */
export const following = query({
  args: {
    live: v.optional(v.boolean()),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireCreatorId(ctx);
    const limit = args.limit ?? 24;
    const offset = args.offset ?? 0;
    if (limit < 1 || limit > 50 || offset < 0) fail("VALIDATION_FAILED");
    const follows = await ctx.db
      .query("follows")
      .withIndex("by_follower_creator", (q) => q.eq("followerId", userId))
      .collect();
    const profiles = (
      await Promise.all(
        follows.map((follow) =>
          ctx.db
            .query("profiles")
            .withIndex("by_user", (q) => q.eq("userId", follow.creatorId))
            .first(),
        ),
      )
    ).filter(
      (profile): profile is Doc<"profiles"> =>
        profile !== null && profile.published && (!args.live || profile.isLive),
    );
    const ranked = profiles.sort(rank).slice(offset, offset + limit);
    return {
      items: await Promise.all(
        ranked.map((profile) => publicProfile(ctx, profile, userId)),
      ),
      nextOffset: offset + limit < profiles.length ? offset + limit : undefined,
    };
  },
});
