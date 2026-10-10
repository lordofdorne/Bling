import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  query,
} from "./_generated/server";
import { requireCreatorId } from "./lib/auth";
import { fail } from "./lib/errors";
import { profileByUsername, rateLimit } from "./lib/social";

// Follows. Ported from backend/internal/social (Follow, FlushCounts) and the
// follower-shard trigger in backend/migrations/000010.
//
// Following is idempotent target state, not a toggle. The relationship
// commits immediately. A creator's follower total lives in 64 shards: each
// follow adjusts one shard chosen at random, so thousands of people following
// one creator at once rarely touch the same document. The profile's
// followerCount is projected from the shards PROJECTION_DELAY_MS later;
// only the first follow in each window schedules that projection.

const SHARDS = 64;
const MAX_FOLLOWS = 1000;
const PROJECTION_DELAY_MS = 5_000;

export const follow = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => setFollow(ctx, username, true),
});

export const unfollow = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => setFollow(ctx, username, false),
});

async function setFollow(ctx: MutationCtx, username: string, follow: boolean) {
  const userId = await requireCreatorId(ctx);
  const creator = await profileByUsername(ctx, username);
  // Unpublished creators cannot gain followers but can still be unfollowed.
  if (!creator || (follow && !creator.published)) fail("CREATOR_NOT_FOUND");
  if (creator.userId === userId) fail("SELF_FOLLOW");

  const existing = await ctx.db
    .query("follows")
    .withIndex("by_follower_creator", (q) =>
      q.eq("followerId", userId).eq("creatorId", creator.userId),
    )
    .first();
  if (Boolean(existing) === follow) return { isFollowing: follow };
  await rateLimit(ctx, `follow:${userId}`, 60);

  const following = await ctx.db
    .query("followingCounts")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  const count = following?.count ?? 0;
  if (follow && count >= MAX_FOLLOWS) fail("FOLLOW_LIMIT");
  const nextCount = count + (follow ? 1 : -1);
  if (following) await ctx.db.patch(following._id, { count: nextCount });
  else await ctx.db.insert("followingCounts", { userId, count: nextCount });

  if (follow) {
    await ctx.db.insert("follows", {
      followerId: userId,
      creatorId: creator.userId,
    });
  } else {
    await ctx.db.delete(existing!._id);
  }
  await adjustShard(ctx, creator.userId, follow ? 1 : -1);
  return { isFollowing: follow };
}

async function adjustShard(
  ctx: MutationCtx,
  creatorId: Id<"users">,
  delta: 1 | -1,
) {
  const start = Math.floor(Math.random() * SHARDS);
  if (delta === 1) {
    const shard = await shardAt(ctx, creatorId, start);
    if (shard) await ctx.db.patch(shard._id, { count: shard.count + 1 });
    else
      await ctx.db.insert("followerShards", {
        creatorId,
        shard: start,
        count: 1,
      });
  } else {
    // Take from the first non-empty shard after a random start, so counts
    // never go negative.
    for (let offset = 0; offset < SHARDS; offset++) {
      const shard = await shardAt(ctx, creatorId, (start + offset) % SHARDS);
      if (shard && shard.count > 0) {
        await ctx.db.patch(shard._id, { count: shard.count - 1 });
        break;
      }
    }
  }
  const pending = await ctx.db
    .query("followerProjections")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .first();
  if (!pending) {
    await ctx.db.insert("followerProjections", { creatorId });
    await ctx.scheduler.runAfter(
      PROJECTION_DELAY_MS,
      internal.follows.project,
      {
        creatorId,
      },
    );
  }
}

function shardAt(ctx: MutationCtx, creatorId: Id<"users">, shard: number) {
  return ctx.db
    .query("followerShards")
    .withIndex("by_creator_shard", (q) =>
      q.eq("creatorId", creatorId).eq("shard", shard),
    )
    .first();
}

/** Sums a creator's shards into their profile's followerCount. */
export const project = internalMutation({
  args: { creatorId: v.id("users") },
  handler: async (ctx, { creatorId }) => {
    const shards = await ctx.db
      .query("followerShards")
      .withIndex("by_creator_shard", (q) => q.eq("creatorId", creatorId))
      .collect();
    const total = shards.reduce((sum, shard) => sum + shard.count, 0);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", creatorId))
      .first();
    if (profile && profile.followerCount !== total) {
      await ctx.db.patch(profile._id, { followerCount: total });
    }
    for (const marker of await ctx.db
      .query("followerProjections")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()) {
      await ctx.db.delete(marker._id);
    }
  },
});

export const followingCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireCreatorId(ctx);
    const row = await ctx.db
      .query("followingCounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return { count: row?.count ?? 0 };
  },
});
