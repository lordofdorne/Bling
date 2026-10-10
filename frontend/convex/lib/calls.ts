import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireUserId } from "./auth";
import { fail } from "./errors";
import { creditEarning } from "./ledger";
import { requestRefund } from "./payments";

// Shared call logic, used by calls.ts, presence.ts, signals.ts and shows.ts.
// Ported from backend/internal/call.

export type CallStatus = Doc<"calls">["status"];
export type Role = "creator" | "viewer";

/** A call in one of these states blocks selecting another caller. */
export const ACTIVE_CALL_STATUSES = [
  "PAYMENT_PENDING",
  "CREATED",
  "CONNECTING",
  "LIVE",
] as const;

/** States in which participants connect, signal and send heartbeats. */
export const CONNECTABLE_STATUSES: readonly CallStatus[] = [
  "CREATED",
  "CONNECTING",
  "LIVE",
];

/** Clients send a heartbeat this often while on a call page. */
export const HEARTBEAT_MS = 10_000;
/** No heartbeat for this long marks a participant disconnected. */
export const PRESENCE_TTL_MS = 30_000;
/** A participant disconnected this long fails the call. */
export const DISCONNECT_GRACE_MS = 20_000;

const TRANSITIONS: Record<CallStatus, readonly CallStatus[]> = {
  PAYMENT_PENDING: [],
  CREATED: ["CONNECTING", "ENDED", "FAILED"],
  CONNECTING: ["LIVE", "ENDED", "FAILED"],
  LIVE: ["ENDED", "FAILED"],
  ENDED: [],
  FAILED: [],
};

export function canTransition(from: CallStatus, to: CallStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The show's call that blocks a new selection, if any. */
export async function activeCallForShow(
  ctx: QueryCtx,
  showId: Id<"shows">,
): Promise<Doc<"calls"> | null> {
  for (const status of ACTIVE_CALL_STATUSES) {
    const call = await ctx.db
      .query("calls")
      .withIndex("by_show_status", (q) =>
        q.eq("showId", showId).eq("status", status),
      )
      .first();
    if (call) return call;
  }
  return null;
}

/**
 * The signed-in user's call and their role in it. Anyone else gets
 * CALL_NOT_FOUND, so call ids reveal nothing.
 */
export async function callForParticipant(
  ctx: QueryCtx,
  callId: Id<"calls">,
): Promise<{ call: Doc<"calls">; role: Role }> {
  const userId = await requireUserId(ctx);
  const call = await ctx.db.get(callId);
  if (call?.creatorId === userId) return { call, role: "creator" };
  if (call?.viewerId === userId) return { call, role: "viewer" };
  fail("CALL_NOT_FOUND");
}

/**
 * Moves a call to a new state and keeps its queue entry in step. Idempotent:
 * asking for the current state returns without writing.
 *
 * A paid call earns the creator their share when it goes LIVE, and is
 * refunded if it finishes before that.
 */
export async function applyTransition(
  ctx: MutationCtx,
  call: Doc<"calls">,
  target: CallStatus,
): Promise<Doc<"calls">> {
  if (call.status === target) return call;
  if (!canTransition(call.status, target)) fail("INVALID_CALL_STATE");
  const now = Date.now();

  const patch: Partial<Doc<"calls">> = { status: target };
  if (target === "LIVE" && call.startedAt === undefined) {
    patch.startedAt = now;
    patch.expiresAt = now + call.callDurationSeconds * 1000;
    // The call ends on time without any polling worker.
    await ctx.scheduler.runAt(patch.expiresAt, internal.calls.expire, {
      callId: call._id,
    });
  }
  // A paid call going live earns the creator their share.
  if (
    target === "LIVE" &&
    call.startedAt === undefined &&
    call.paymentAttemptId
  ) {
    const attempt = await ctx.db.get(call.paymentAttemptId);
    if (attempt) await creditEarning(ctx, attempt, call._id, now);
  }
  const finished = target === "ENDED" || target === "FAILED";
  if (finished) patch.endedAt = now;
  await ctx.db.patch(call._id, patch);

  // The caller's entry follows the call; a failed call simply ends it.
  await ctx.db.patch(call.queueEntryId, {
    status: target === "CONNECTING" || target === "LIVE" ? target : "ENDED",
  });

  if (finished) {
    // A paid call that never went live is refunded in full.
    if (call.startedAt === undefined && call.paymentAttemptId) {
      const attempt = await ctx.db.get(call.paymentAttemptId);
      if (attempt) {
        await requestRefund(
          ctx,
          attempt,
          call._id,
          target === "FAILED"
            ? "call_failed_before_live"
            : "call_ended_before_live",
        );
      }
    }
    // Signals and presence only matter while a call is open.
    await ctx.scheduler.runAfter(0, internal.signals.purge, {
      callId: call._id,
    });
    for (const presence of await ctx.db
      .query("callPresence")
      .withIndex("by_call_role", (q) => q.eq("callId", call._id))
      .collect()) {
      await ctx.db.delete(presence._id);
    }
  }
  return (await ctx.db.get(call._id))!;
}

/** The caller details a creator sees for a call. */
export async function withCaller(ctx: QueryCtx, call: Doc<"calls">) {
  const entry = await ctx.db.get(call.queueEntryId);
  const presence = await ctx.db
    .query("callPresence")
    .withIndex("by_call_role", (q) => q.eq("callId", call._id))
    .collect();
  const disconnectedAt = (role: Role) =>
    presence.find((row) => row.role === role)?.disconnectedAt;
  return {
    _id: call._id,
    showId: call.showId,
    queueEntryId: call.queueEntryId,
    status: call.status,
    selectionMode: call.selectionMode,
    callDurationSeconds: call.callDurationSeconds,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    expiresAt: call.expiresAt,
    createdAt: call._creationTime,
    creatorDisconnectedAt: disconnectedAt("creator"),
    viewerDisconnectedAt: disconnectedAt("viewer"),
    caller: entry && {
      _id: entry._id,
      displayName: entry.displayName,
      topic: entry.topic,
      tierName: entry.tierName,
      priorityRank: entry.priorityRank,
      callDurationSeconds: entry.callDurationSeconds,
      priceCents: entry.tierPriceCents,
    },
  };
}
