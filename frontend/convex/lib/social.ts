import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";

// Social helpers shared by profiles, follows, directory, notifications,
// channels and shows. Ported from backend/internal/social and the triggers
// in backend/migrations/000010 (profile creation, show projection), which
// become explicit calls here.

export const NOTIFICATION_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** A channel visitor counts this long after their last heartbeat. */
export const VISITOR_TTL_MS = 90_000;
/** How often a live show's visitor count is recomputed. */
export const VISITOR_COUNT_INTERVAL_MS = 30_000;

export function searchText(
  profile: Pick<Doc<"profiles">, "username" | "displayName" | "bio">,
) {
  return `${profile.username} ${profile.displayName} ${profile.bio}`;
}

/** Creates the unpublished profile every new account gets. */
export async function createProfile(
  ctx: MutationCtx,
  userId: Id<"users">,
  username: string,
) {
  await ctx.db.insert("profiles", {
    userId,
    username,
    displayName: username,
    bio: "",
    avatarUrl: "",
    coverUrl: "",
    published: false,
    followerCount: 0,
    isLive: false,
    searchText: searchText({ username, displayName: username, bio: "" }),
  });
}

export function profileForUser(ctx: QueryCtx, userId: Id<"users">) {
  return ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

export function profileByUsername(ctx: QueryCtx, username: string) {
  return ctx.db
    .query("profiles")
    .withIndex("by_username", (q) =>
      q.eq("username", username.trim().toLowerCase()),
    )
    .first();
}

// ------------------------------------------------------------ shows

/** Creating a show makes its creator discoverable. */
export async function onShowCreated(ctx: MutationCtx, creatorId: Id<"users">) {
  const profile = await profileForUser(ctx, creatorId);
  if (profile && !profile.published) {
    await ctx.db.patch(profile._id, { published: true });
  }
}

/**
 * Going live publishes the profile, marks it live and records one live
 * event per show for followers. A fixed amount of work: followers are never
 * walked here; each follower's notification query finds the event.
 */
export async function onShowLive(ctx: MutationCtx, show: Doc<"shows">) {
  const profile = await profileForUser(ctx, show.creatorId);
  if (profile) {
    await ctx.db.patch(profile._id, {
      published: true,
      isLive: true,
      liveShowId: show._id,
      liveStartedAt: show.startedAt,
    });
  }
  const existing = await ctx.db
    .query("liveEvents")
    .withIndex("by_show", (q) => q.eq("showId", show._id))
    .first();
  if (!existing) {
    await ctx.db.insert("liveEvents", {
      creatorId: show.creatorId,
      showId: show._id,
    });
  }
}

export async function onShowEnded(ctx: MutationCtx, show: Doc<"shows">) {
  const profile = await profileForUser(ctx, show.creatorId);
  if (profile?.liveShowId === show._id) {
    await ctx.db.patch(profile._id, {
      isLive: false,
      liveShowId: undefined,
      liveStartedAt: undefined,
    });
  }
}

// ------------------------------------------------------------ views

/** The public view of a profile. Never includes email or payment data. */
export async function publicProfile(
  ctx: QueryCtx,
  profile: Doc<"profiles">,
  viewerId: Id<"users"> | null,
) {
  const following =
    viewerId !== null &&
    (await ctx.db
      .query("follows")
      .withIndex("by_follower_creator", (q) =>
        q.eq("followerId", viewerId).eq("creatorId", profile.userId),
      )
      .first()) !== null;
  const liveShowId = profile.liveShowId;
  const stats =
    profile.isLive && liveShowId
      ? await ctx.db
          .query("channelStats")
          .withIndex("by_show", (q) => q.eq("showId", liveShowId))
          .first()
      : null;
  return {
    _id: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: await avatarUrl(ctx, profile),
    coverUrl: profile.coverUrl,
    published: profile.published,
    followerCount: profile.followerCount,
    isLive: profile.isLive,
    liveShowId: profile.liveShowId,
    liveStartedAt: profile.liveStartedAt,
    isFollowing: following,
    channelVisitors: profile.isLive ? (stats?.visitors ?? 0) : undefined,
  };
}

export async function avatarUrl(ctx: QueryCtx, profile: Doc<"profiles">) {
  if (profile.avatarStorageId) {
    return (await ctx.storage.getUrl(profile.avatarStorageId)) ?? "";
  }
  return profile.avatarUrl;
}

// ------------------------------------------------------------ limits

/**
 * Per-user limits on social writes, in fixed one-minute windows, matching
 * the Go API's numbers. Each key is one user's own row, so limits never
 * contend across users. (The Go API's per-IP limit has no equivalent: Convex
 * functions do not see client addresses.)
 */
export async function rateLimit(
  ctx: MutationCtx,
  key: string,
  perMinute: number,
) {
  const now = Date.now();
  const windowStart = now - (now % 60_000);
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (!row) {
    await ctx.db.insert("rateLimits", { key, windowStart, count: 1 });
    return;
  }
  if (row.windowStart !== windowStart) {
    await ctx.db.patch(row._id, { windowStart, count: 1 });
    return;
  }
  if (row.count >= perMinute) fail("RATE_LIMITED");
  await ctx.db.patch(row._id, { count: row.count + 1 });
}
