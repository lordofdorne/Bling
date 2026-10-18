import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { iso } from "../backend";
import type { BlingCall } from "../calls";
import type { HotlineShow, HotlineTier } from "../shows";
import type { QueueEntry, QueueTier } from "../queue";
import type { CreatorProfile } from "../social";

// Convex documents use _id and millisecond timestamps; the app's types (from
// the Go API) use id and ISO strings. These keep every component unchanged.

type ShowDoc = NonNullable<FunctionReturnType<typeof api.shows.current>>;

export function toShow(
  show: Pick<ShowDoc, "_id" | "status" | "startedAt"> &
    Partial<
      Pick<ShowDoc, "creatorId" | "endedAt" | "_creationTime" | "scheduledFor">
    >,
): HotlineShow {
  const created = iso(show._creationTime ?? show.startedAt ?? Date.now())!;
  return {
    id: show._id,
    creatorId: show.creatorId ?? "",
    status: show.status,
    startedAt: iso(show.startedAt),
    endedAt: iso(show.endedAt),
    createdAt: created,
    updatedAt: created,
    scheduledFor: iso(show.scheduledFor),
  };
}

type TierDoc = FunctionReturnType<typeof api.tiers.forCreator>[number];

export function toTier(tier: TierDoc): HotlineTier {
  const created = iso(tier._creationTime)!;
  return {
    id: tier._id,
    name: tier.name,
    priorityRank: tier.priorityRank,
    callDurationSeconds: tier.callDurationSeconds,
    priceCents: tier.priceCents,
    enabled: tier.enabled,
    createdAt: created,
    updatedAt: created,
  };
}

type PublicTier = FunctionReturnType<typeof api.tiers.forLiveShow>[number];

export function toQueueTier(tier: PublicTier): QueueTier {
  return {
    id: tier._id,
    name: tier.name,
    priorityRank: tier.priorityRank,
    callDurationSeconds: tier.callDurationSeconds,
    priceCents: tier.priceCents,
  };
}

// The creator's list adds caller insight; a caller's own entry has none.
type EntryDoc = Omit<
  FunctionReturnType<typeof api.queue.waiting>[number],
  "caller"
> &
  Partial<Pick<FunctionReturnType<typeof api.queue.waiting>[number], "caller">>;

export function toEntry(entry: EntryDoc): QueueEntry {
  return {
    id: entry._id,
    showId: entry.showId,
    displayName: entry.displayName,
    topic: entry.topic,
    status: entry.status,
    tierId: entry.tierId,
    tierName: entry.tierName,
    priorityRank: entry.priorityRank,
    callDurationSeconds: entry.callDurationSeconds,
    tierPriceCents: entry.tierPriceCents,
    joinedAt: iso(entry.joinedAt)!,
    caller: entry.caller,
  };
}

type CallDoc = NonNullable<FunctionReturnType<typeof api.calls.active>>;

export function toCall(call: CallDoc): BlingCall {
  const created = iso(call.createdAt)!;
  return {
    id: call._id,
    showId: call.showId,
    queueEntryId: call.queueEntryId,
    status: call.status,
    selectionMode: call.selectionMode,
    callDurationSeconds: call.callDurationSeconds,
    startedAt: iso(call.startedAt),
    endedAt: iso(call.endedAt),
    expiresAt: iso(call.expiresAt),
    createdAt: created,
    updatedAt: created,
    caller: {
      id: call.caller?._id ?? call.queueEntryId,
      displayName: call.caller?.displayName ?? "",
      topic: call.caller?.topic ?? "",
      tierName: call.caller?.tierName ?? "",
      priorityRank: call.caller?.priorityRank ?? 0,
      callDurationSeconds:
        call.caller?.callDurationSeconds ?? call.callDurationSeconds,
    },
  };
}

type ProfileDoc = NonNullable<FunctionReturnType<typeof api.profiles.get>>;

export function toProfile(profile: ProfileDoc): CreatorProfile {
  return {
    id: profile._id,
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    coverUrl: profile.coverUrl,
    published: profile.published,
    followerCount: profile.followerCount,
    isLive: profile.isLive,
    liveShowId: profile.liveShowId ?? null,
    liveStartedAt: iso(profile.liveStartedAt),
    isFollowing: profile.isFollowing,
    channelVisitors: profile.channelVisitors ?? null,
    nextHotlineAt: iso(profile.nextHotlineAt),
  };
}
