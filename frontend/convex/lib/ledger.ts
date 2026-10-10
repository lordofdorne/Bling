import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// The creator ledger. Ported from backend/migrations/000012 (the ledger
// table and its refund and dispute triggers) and backend/internal/call
// (earnings). Postgres triggers become explicit calls from the code that
// changes a refund or dispute, inside the same mutation.

export const HOUR_MS = 60 * 60_000;

/** Earnings become available this long after the call goes live. */
export function earningsHoldMs(): number {
  const hours = Number(process.env.CREATOR_EARNINGS_HOLD_HOURS ?? 168);
  return (Number.isFinite(hours) && hours >= 0 ? hours : 168) * HOUR_MS;
}

type NewEntry = Omit<Doc<"ledgerEntries">, "_id" | "_creationTime">;

/**
 * Posts an entry unless its idempotency key already exists, and keeps the
 * creator's running total in step. Returns whether it was posted.
 */
export async function postEntry(ctx: MutationCtx, entry: NewEntry) {
  if (entry.amountCents === 0) return false;
  const existing = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_key", (q) => q.eq("idempotencyKey", entry.idempotencyKey))
    .first();
  if (existing) return false;
  await ctx.db.insert("ledgerEntries", entry);
  const balance = await ctx.db
    .query("creatorBalances")
    .withIndex("by_creator_currency", (q) =>
      q.eq("creatorId", entry.creatorId).eq("currency", entry.currency),
    )
    .first();
  if (balance) {
    await ctx.db.patch(balance._id, {
      totalCents: balance.totalCents + entry.amountCents,
    });
  } else {
    await ctx.db.insert("creatorBalances", {
      creatorId: entry.creatorId,
      currency: entry.currency,
      totalCents: entry.amountCents,
    });
  }
  return true;
}

/**
 * Total, held and available amounts at a moment. Only entries not yet
 * effective are read (at most the hold period's worth), never the history.
 */
export async function balanceAt(
  ctx: QueryCtx,
  creatorId: Id<"users">,
  currency: string,
  now: number,
) {
  const balance = await ctx.db
    .query("creatorBalances")
    .withIndex("by_creator_currency", (q) =>
      q.eq("creatorId", creatorId).eq("currency", currency),
    )
    .first();
  const held = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_creator_currency_effective", (q) =>
      q
        .eq("creatorId", creatorId)
        .eq("currency", currency)
        .gt("effectiveAt", now),
    )
    .collect();
  const totalCents = balance?.totalCents ?? 0;
  const pendingCents = held.reduce((sum, entry) => sum + entry.amountCents, 0);
  return {
    currency,
    totalCents,
    pendingCents,
    availableCents: totalCents - pendingCents,
  };
}

async function earningFor(ctx: QueryCtx, attemptId: Id<"paymentAttempts">) {
  return ctx.db
    .query("ledgerEntries")
    .withIndex("by_attempt_kind", (q) =>
      q.eq("paymentAttemptId", attemptId).eq("kind", "EARNING"),
    )
    .first();
}

/** A paid call went live: credit the creator their share, held for a week. */
export async function creditEarning(
  ctx: MutationCtx,
  attempt: Doc<"paymentAttempts">,
  callId: Id<"calls">,
  liveAt: number,
) {
  if (attempt.status !== "CAPTURED") return;
  await postEntry(ctx, {
    creatorId: attempt.creatorId,
    kind: "EARNING",
    amountCents: attempt.amountCents - attempt.platformFeeCents,
    currency: attempt.currency,
    effectiveAt: liveAt + earningsHoldMs(),
    idempotencyKey: `earning:${attempt._id}`,
    paymentAttemptId: attempt._id,
    callId,
    metadata: {
      grossCents: attempt.amountCents,
      platformFeeCents: attempt.platformFeeCents,
      basicCardFeeCents: attempt.basicCardFeeCents,
      creatorProcessingFeeCents: attempt.creatorProcessingFeeCents,
    },
  });
}

/** A refund succeeded: take back the creator's share, if one was credited. */
export async function reverseForRefund(
  ctx: MutationCtx,
  refund: Doc<"paymentRefunds">,
) {
  const earning = await earningFor(ctx, refund.paymentAttemptId);
  if (!earning) return;
  await postEntry(ctx, {
    creatorId: earning.creatorId,
    kind: "REFUND_REVERSAL",
    amountCents: -earning.amountCents,
    currency: earning.currency,
    effectiveAt: Date.now(),
    idempotencyKey: `refund:${refund._id}`,
    paymentAttemptId: refund.paymentAttemptId,
    callId: refund.callId,
    metadata: { refundId: refund.stripeRefundId ?? "" },
  });
}

const DISPUTE_OPEN = new Set([
  "needs_response",
  "under_review",
  "lost",
  "warning_needs_response",
  "warning_under_review",
]);
const DISPUTE_RESOLVED = new Set(["won", "warning_closed", "prevented"]);

/**
 * An open or lost dispute holds back the creator's share; a dispute Bling
 * wins releases it. Each happens at most once per dispute.
 */
export async function adjustForDispute(
  ctx: MutationCtx,
  dispute: Doc<"paymentDisputes">,
) {
  if (!dispute.paymentAttemptId) return;
  const earning = await earningFor(ctx, dispute.paymentAttemptId);
  if (!earning) return;
  const base = {
    creatorId: earning.creatorId,
    currency: earning.currency,
    effectiveAt: Date.now(),
    paymentAttemptId: dispute.paymentAttemptId,
    metadata: { disputeId: dispute.stripeDisputeId, status: dispute.status },
  };
  if (DISPUTE_OPEN.has(dispute.status)) {
    await postEntry(ctx, {
      ...base,
      kind: "DISPUTE_DEBIT",
      amountCents: -earning.amountCents,
      idempotencyKey: `dispute-debit:${dispute.stripeDisputeId}`,
    });
  } else if (DISPUTE_RESOLVED.has(dispute.status)) {
    const debit = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_key", (q) =>
        q.eq("idempotencyKey", `dispute-debit:${dispute.stripeDisputeId}`),
      )
      .first();
    if (!debit) return;
    await postEntry(ctx, {
      ...base,
      kind: "DISPUTE_RELEASE",
      amountCents: -debit.amountCents,
      idempotencyKey: `dispute-release:${dispute.stripeDisputeId}`,
    });
  }
}
