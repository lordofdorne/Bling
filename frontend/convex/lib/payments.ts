import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Payment state changes shared by calls, the queue, scheduled Stripe actions
// and the webhook. Ported from backend/internal/payment and finance. Every
// function here runs inside one mutation, so each change is atomic with the
// call and queue updates around it.

/** Asks Stripe to release a hold (scheduled, since mutations cannot call out). */
export async function scheduleCancel(
  ctx: MutationCtx,
  attempt: Doc<"paymentAttempts">,
  reason: string,
) {
  if (
    attempt.stripePaymentIntentId &&
    (attempt.status === "CREATED" || attempt.status === "AUTHORIZED")
  ) {
    await ctx.scheduler.runAfter(0, internal.payments.cancelIntent, {
      attemptId: attempt._id,
      reason,
    });
  }
}

/** Records one refund per captured attempt and starts processing it. */
export async function requestRefund(
  ctx: MutationCtx,
  attempt: Doc<"paymentAttempts">,
  callId: Id<"calls">,
  reason: string,
) {
  if (attempt.status !== "CAPTURED" || !attempt.stripePaymentIntentId) return;
  const existing = await ctx.db
    .query("paymentRefunds")
    .withIndex("by_attempt", (q) => q.eq("paymentAttemptId", attempt._id))
    .first();
  if (existing) return;
  const refundId = await ctx.db.insert("paymentRefunds", {
    paymentAttemptId: attempt._id,
    callId,
    stripePaymentIntentId: attempt.stripePaymentIntentId,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
    reason,
    status: "REQUESTED",
    attempts: 0,
    nextAttemptAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.refunds.run, { refundId });
}

export async function callForAttempt(
  ctx: MutationCtx,
  attemptId: Id<"paymentAttempts">,
) {
  return ctx.db
    .query("calls")
    .withIndex("by_payment_attempt", (q) => q.eq("paymentAttemptId", attemptId))
    .first();
}

/**
 * Stripe captured the payment (from the capture action or the webhook,
 * whichever arrives first; the second is a no-op). A paid call waiting on the
 * capture opens; if its show ended meanwhile, the call fails and the payment
 * is refunded.
 */
export async function recordCaptured(
  ctx: MutationCtx,
  attempt: Doc<"paymentAttempts">,
) {
  if (attempt.status !== "CAPTURED") {
    await ctx.db.patch(attempt._id, {
      status: "CAPTURED",
      capturedAt: attempt.capturedAt ?? Date.now(),
    });
  }
  const captured = (await ctx.db.get(attempt._id))!;
  const call = await callForAttempt(ctx, attempt._id);
  if (!call) return;
  const show = await ctx.db.get(call.showId);
  const showLive = show?.status === "LIVE";

  if (call.status === "PAYMENT_PENDING" && showLive) {
    await ctx.db.patch(call._id, { status: "CREATED" });
    return;
  }
  if (call.startedAt === undefined && !showLive) {
    if (call.status === "PAYMENT_PENDING") {
      await ctx.db.patch(call._id, { status: "FAILED", endedAt: Date.now() });
      await ctx.db.patch(call.queueEntryId, { status: "ENDED" });
    }
    await requestRefund(
      ctx,
      captured,
      call._id,
      "show_ended_before_call_started",
    );
  }
}

/**
 * The payment will not be captured (declined, canceled or failed). A paid
 * call waiting on it fails, and the caller is released from the queue so
 * they can try again.
 */
export async function recordNotCaptured(
  ctx: MutationCtx,
  attempt: Doc<"paymentAttempts">,
  status: "CANCELED" | "FAILED",
  failureCode?: string,
) {
  if (attempt.status === "CAPTURED") return;
  await ctx.db.patch(attempt._id, {
    status,
    failureCode,
    ...(status === "CANCELED" && {
      canceledAt: attempt.canceledAt ?? Date.now(),
    }),
  });
  const call = await callForAttempt(ctx, attempt._id);
  if (call?.status === "PAYMENT_PENDING") {
    await ctx.db.patch(call._id, { status: "FAILED", endedAt: Date.now() });
  }
  if (attempt.queueEntryId) {
    const entry = await ctx.db.get(attempt.queueEntryId);
    const waitingOnPayment =
      entry?.status === "WAITING" ||
      (entry?.status === "SELECTED" && call?.status === "PAYMENT_PENDING");
    if (entry && waitingOnPayment) {
      await ctx.db.patch(entry._id, { status: "LEFT", leftAt: Date.now() });
    }
  }
}
