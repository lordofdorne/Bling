import { v } from "convex/values";
import type Stripe from "stripe";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { reverseForRefund } from "./lib/ledger";
import { stripeClient } from "./lib/stripe";

// Automatic refunds for paid calls that never went live. Ported from
// backend/internal/finance (refund worker).
//
// lib/payments.requestRefund records a REQUESTED refund and schedules
// run. run claims it (PROCESSING with a lease), calls Stripe with a
// stable idempotency key, and records the outcome: SUCCEEDED and FAILED are
// final, PENDING is checked again later, errors retry with exponential
// backoff, giving up as FAILED after MAX_ATTEMPTS. The payments sweep
// re-schedules anything whose action died, so nothing is left PROCESSING.

const MAX_ATTEMPTS = 10;
const LEASE_MS = 5 * 60_000;
const PENDING_RECHECK_MS = 5 * 60_000;
const SWEEP_BATCH = 50;

function statusFromStripe(
  status: string | null | undefined,
): "SUCCEEDED" | "FAILED" | "PENDING" {
  if (status === "succeeded") return "SUCCEEDED";
  if (status === "failed" || status === "canceled") return "FAILED";
  return "PENDING";
}

export const run = internalAction({
  args: { refundId: v.id("paymentRefunds") },
  handler: async (ctx, { refundId }) => {
    const refund = await ctx.runMutation(internal.refunds.claim, { refundId });
    if (!refund) return;
    const stripe = stripeClient();
    let result: Stripe.Refund;
    try {
      // Once Stripe has a refund, check it rather than create another:
      // idempotency keys expire after a day, and a PENDING refund may be
      // rechecked later than that.
      result = refund.stripeRefundId
        ? await stripe.refunds.retrieve(refund.stripeRefundId)
        : await stripe.refunds.create(
            {
              payment_intent: refund.stripePaymentIntentId,
              metadata: {
                bling_refund_request_id: refund._id,
                bling_payment_attempt_id: refund.paymentAttemptId,
                bling_call_id: refund.callId,
              },
            },
            { idempotencyKey: `bling-refund-${refund._id}` },
          );
    } catch (error) {
      console.error("Stripe refund failed", (error as Error).message);
      await ctx.runMutation(internal.refunds.retry, {
        refundId,
        failureCode: "provider_error",
      });
      return;
    }
    await ctx.runMutation(internal.refunds.record, {
      refundId,
      stripeRefundId: result.id,
      status: statusFromStripe(result.status),
      failureCode: result.failure_reason ?? undefined,
    });
  },
});

/** Takes a refund for processing if it is due and not already in hand. */
export const claim = internalMutation({
  args: { refundId: v.id("paymentRefunds") },
  handler: async (ctx, { refundId }) => {
    const refund = await ctx.db.get(refundId);
    if (!refund || refund.attempts >= MAX_ATTEMPTS) return null;
    const now = Date.now();
    const due =
      refund.status === "REQUESTED" ||
      ((refund.status === "RETRY" ||
        refund.status === "PENDING" ||
        refund.status === "PROCESSING") &&
        refund.nextAttemptAt <= now);
    if (!due) return null;
    await ctx.db.patch(refundId, {
      status: "PROCESSING",
      attempts: refund.attempts + 1,
      nextAttemptAt: now + LEASE_MS,
    });
    return (await ctx.db.get(refundId))!;
  },
});

export const record = internalMutation({
  args: {
    refundId: v.id("paymentRefunds"),
    stripeRefundId: v.string(),
    status: v.union(
      v.literal("SUCCEEDED"),
      v.literal("FAILED"),
      v.literal("PENDING"),
    ),
    failureCode: v.optional(v.string()),
  },
  handler: async (ctx, { refundId, stripeRefundId, status, failureCode }) => {
    const refund = await ctx.db.get(refundId);
    // A webhook may already have reported the final outcome.
    if (
      !refund ||
      refund.status === "SUCCEEDED" ||
      refund.status === "FAILED"
    ) {
      return;
    }
    const now = Date.now();
    const final = status !== "PENDING";
    await ctx.db.patch(refundId, {
      stripeRefundId,
      status,
      failureCode,
      nextAttemptAt: now + PENDING_RECHECK_MS,
      processedAt: final ? now : undefined,
    });
    if (status === "SUCCEEDED") {
      await reverseForRefund(ctx, (await ctx.db.get(refundId))!);
    }
    if (!final) {
      await ctx.scheduler.runAfter(PENDING_RECHECK_MS, internal.refunds.run, {
        refundId,
      });
    }
  },
});

export const retry = internalMutation({
  args: { refundId: v.id("paymentRefunds"), failureCode: v.string() },
  handler: async (ctx, { refundId, failureCode }) => {
    const refund = await ctx.db.get(refundId);
    if (!refund || refund.status !== "PROCESSING") return;
    const now = Date.now();
    if (refund.attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(refundId, {
        status: "FAILED",
        failureCode,
        processedAt: now,
      });
      return;
    }
    const delay = 1000 * 2 ** Math.min(refund.attempts, 8);
    await ctx.db.patch(refundId, {
      status: "RETRY",
      failureCode,
      nextAttemptAt: now + delay,
    });
    await ctx.scheduler.runAfter(delay, internal.refunds.run, { refundId });
  },
});

/** Refunds that are due but have no live action, for the payments sweep. */
export const due = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const ids = [];
    for (const status of [
      "REQUESTED",
      "RETRY",
      "PENDING",
      "PROCESSING",
    ] as const) {
      const rows = await ctx.db
        .query("paymentRefunds")
        .withIndex("by_status_next", (q) =>
          q.eq("status", status).lte("nextAttemptAt", now),
        )
        .take(SWEEP_BATCH);
      ids.push(
        ...rows
          .filter((row) => row.attempts < MAX_ATTEMPTS)
          .map((row) => row._id),
      );
    }
    return ids;
  },
});

/**
 * Every minute: re-schedules refunds and creator transfers whose action never
 * ran or died, and captures stuck in PAYMENT_PENDING for over two minutes.
 * All are idempotent, so a duplicate run is harmless.
 */
export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const refundId of await ctx.runQuery(internal.refunds.due, { now })) {
      await ctx.scheduler.runAfter(0, internal.refunds.run, { refundId });
    }
    const stalled = await ctx.runQuery(internal.payments.stalledCaptures, {
      olderThan: now - 2 * 60_000,
    });
    for (const callId of stalled) {
      await ctx.scheduler.runAfter(0, internal.payments.capture, { callId });
    }
    for (const itemId of await ctx.runQuery(internal.payouts.dueTransfers, {
      now,
    })) {
      await ctx.scheduler.runAfter(0, internal.payouts.transfer, { itemId });
    }
  },
});
