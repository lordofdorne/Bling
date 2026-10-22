import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireCreatorId } from "./lib/auth";
import { fail } from "./lib/errors";
import { isTopic, MAX_TOPICS } from "./lib/topics";
import {
  profileByUsername,
  profileForUser,
  publicProfile,
  rateLimit,
  searchText,
} from "./lib/social";

// Creator profiles. Ported from backend/internal/social (profile and avatar
// routes). Avatars move from Postgres bytes / Supabase Storage to Convex file
// storage: the browser uploads to a short-lived URL, then setAvatar checks
// the file and attaches it.

const AVATAR_MAX_BYTES = 768 * 1024;

/** Public: a published profile, or the owner's own unpublished one. */
export const get = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const viewerId = await getAuthUserId(ctx);
    const profile = await profileByUsername(ctx, username);
    if (!profile || (!profile.published && profile.userId !== viewerId)) {
      return null;
    }
    return publicProfile(ctx, profile, viewerId);
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireCreatorId(ctx);
    const profile = await profileForUser(ctx, userId);
    if (!profile) fail("CREATOR_NOT_FOUND");
    return publicProfile(ctx, profile, userId);
  },
});

function validHttpsUrl(raw: string) {
  if (raw.length > 2048) return false;
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      url.hostname !== "" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/**
 * Saves profile details. avatarUrl: leave out to keep the current avatar,
 * "" to remove it, or an https URL to use an external image. topics: leave
 * out to keep the current ones. A live profile stays published.
 */
export const save = mutation({
  args: {
    displayName: v.string(),
    bio: v.string(),
    avatarUrl: v.optional(v.string()),
    coverUrl: v.string(),
    published: v.boolean(),
    topics: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireCreatorId(ctx);
    await rateLimit(ctx, `profile:${userId}`, 20);
    const profile = await profileForUser(ctx, userId);
    if (!profile) fail("CREATOR_NOT_FOUND");

    const displayName = args.displayName.trim();
    const bio = args.bio.trim();
    const coverUrl = args.coverUrl.trim();
    const avatar = args.avatarUrl?.trim();
    const lengthOf = (value: string) => [...value].length;
    if (
      lengthOf(displayName) < 1 ||
      lengthOf(displayName) > 60 ||
      lengthOf(bio) > 500
    ) {
      fail("VALIDATION_FAILED", "Check your display name and bio.");
    }
    // The form sends back the avatar URL it was given; for an uploaded avatar
    // that is its storage URL, which means "keep it".
    const keepsUpload =
      profile.avatarStorageId !== undefined &&
      avatar === (await ctx.storage.getUrl(profile.avatarStorageId));
    if (
      (coverUrl && !validHttpsUrl(coverUrl)) ||
      (avatar && !keepsUpload && !validHttpsUrl(avatar))
    ) {
      fail("VALIDATION_FAILED", "Images must be https links.");
    }
    const topics = args.topics
      ? [...new Set(args.topics)]
      : (profile.topics ?? []);
    if (topics.length > MAX_TOPICS || !topics.every(isTopic)) {
      fail("VALIDATION_FAILED", `Pick up to ${MAX_TOPICS} topics.`);
    }

    const patch = {
      displayName,
      bio,
      coverUrl,
      published: args.published || profile.isLive,
      topics,
      searchText: searchText({
        username: profile.username,
        displayName,
        bio,
        topics,
      }),
    };
    if (avatar === undefined || keepsUpload) {
      await ctx.db.patch(profile._id, patch);
    } else {
      if (profile.avatarStorageId)
        await ctx.storage.delete(profile.avatarStorageId);
      await ctx.db.patch(profile._id, {
        ...patch,
        avatarUrl: avatar,
        avatarStorageId: undefined,
      });
    }
    return publicProfile(ctx, (await ctx.db.get(profile._id))!, userId);
  },
});

export const avatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireCreatorId(ctx);
    await rateLimit(ctx, `avatar:${userId}`, 10);
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Attaches an uploaded avatar: a JPG, PNG or WebP of at most 768 KB. The
 * type comes from the file's own first bytes, not the Content-Type the
 * browser sent. A rejected upload is deleted.
 */
export const setAvatar = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<PublicProfile> => {
    const blob = await ctx.storage.get(storageId);
    const header = blob
      ? new Uint8Array(await blob.slice(0, 12).arrayBuffer())
      : null;
    if (
      !blob ||
      blob.size > AVATAR_MAX_BYTES ||
      !header ||
      !isAvatarImage(header)
    ) {
      // Only an unattached file is deleted, so nobody can remove another
      // creator's avatar by passing its id.
      await ctx.runMutation(internal.profiles.discardUpload, { storageId });
      fail("INVALID_AVATAR", "Use a JPG, PNG or WebP image up to 768 KB.");
    }
    return ctx.runMutation(internal.profiles.attachAvatar, { storageId });
  },
});

type PublicProfile = Awaited<ReturnType<typeof publicProfile>>;

function isAvatarImage(bytes: Uint8Array) {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
    (b, i) => bytes[i] === b,
  );
  const webp = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  return jpeg || png || webp;
}

async function avatarOwner(ctx: QueryCtx, storageId: Id<"_storage">) {
  return ctx.db
    .query("profiles")
    .withIndex("by_avatar", (q) => q.eq("avatarStorageId", storageId))
    .first();
}

export const discardUpload = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    if (
      !(await avatarOwner(ctx, storageId)) &&
      (await ctx.db.system.get(storageId))
    ) {
      await ctx.storage.delete(storageId);
    }
  },
});

export const attachAvatar = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const userId = await requireCreatorId(ctx);
    const profile = await profileForUser(ctx, userId);
    if (!profile) fail("CREATOR_NOT_FOUND");
    // A file already attached to another profile cannot be claimed (and so
    // later deleted) by someone else who learned its id.
    const owner = await avatarOwner(ctx, storageId);
    if (owner && owner._id !== profile._id) fail("INVALID_AVATAR");
    if (profile.avatarStorageId && profile.avatarStorageId !== storageId) {
      await ctx.storage.delete(profile.avatarStorageId);
    }
    await ctx.db.patch(profile._id, {
      avatarStorageId: storageId,
      avatarUrl: "",
    });
    return publicProfile(ctx, (await ctx.db.get(profile._id))!, userId);
  },
});
