import { v } from "convex/values";
import type Stripe from "stripe";
import { internal } from "./_generated/api";
import { httpAction, internalMutation } from "./_generated/server";
import { adjustForDispute, reverseForRefund } from "./lib/ledger";
import { recordCaptured, recordNotCaptured } from "./lib/payments";
import { stripeClient, webhookSecret } from "./lib/stripe";

// Stripe webhook, served at <CONVEX_SITE_URL>/stripe/webhook. Ported from
// backend/internal/httpapi/payment.go.
//
// The HTTP action verifies the signature and reduces the event to the fields
// Bling uses; apply then records the event id and applies it in a single
// transaction. A redelivered event finds its id and does nothing, so the Go
// API's claim / processing / complete states are not needed.

const SUPPORTED = new Set([
  "account.updated",
  "payment_intent.succeeded",
  "payment_intent.canceled",
  "payment_intent.payment_failed",
  "setup_intent.succeeded",
  "payment_method.attached",
  "payment_method.detached",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "payout.created",
  "payout.updated",
  "payout.paid",
  "payout.failed",
]);

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;

export const stripeWebhook = httpAction(async (ctx, request) => {
  const secret = webhookSecret();
  if (!secret) {
    return Response.json(
      { error: { code: "WEBHOOK_DISABLED" } },
      { status: 503 },
    );
  }
  const body = await request.text();
  if (body.length > 1 << 20) return new Response(null, { status: 413 });
  let event: Stripe.Event;
  try {
    event = await stripeClient().webhooks.constructEventAsync(
      body,
      request.headers.get("stripe-signature") ?? "",
      secret,
    );
  } catch {
    return Response.json(
      { error: { code: "INVALID_WEBHOOK_SIGNATURE" } },
      { status: 400 },
    );
  }
  if (!SUPPORTED.has(event.type)) return new Response(null, { status: 204 });

  const base = {
    eventId: event.id,
    type: event.type,
    connectedAccountId: event.account ?? undefined,
  };
  const object = event.data.object as unknown as Record<string, unknown>;
  if (event.type.startsWith("payment_intent.")) {
    const intent = object as unknown as Stripe.PaymentIntent;
    await ctx.runMutation(internal.webhooks.apply, {
      ...base,
      intent: {
        id: intent.id,
        failureCode: intent.last_payment_error?.code ?? undefined,
        customerId: idOf(intent.customer),
        paymentMethodId: idOf(intent.payment_method),
        savedForFuture: Boolean(intent.setup_future_usage),
      },
    });
  } else if (event.type.startsWith("refund.")) {
    const refund = object as unknown as Stripe.Refund;
    await ctx.runMutation(internal.webhooks.apply, {
      ...base,
      refund: {
        id: refund.id,
        intentId: idOf(refund.payment_intent),
        status: refund.status ?? "",
        failureReason: refund.failure_reason ?? undefined,
      },
    });
  } else if (event.type.startsWith("charge.dispute.")) {
    const dispute = object as unknown as Stripe.Dispute;
    await ctx.runMutation(internal.webhooks.apply, {
      ...base,
      dispute: {
        id: dispute.id,
        intentId: idOf(dispute.payment_intent),
        amountCents: dispute.amount,
        currency: dispute.currency,
        reason: dispute.reason,
        status: dispute.status,
        evidenceDueAt: dispute.evidence_details?.due_by
          ? dispute.evidence_details.due_by * 1000
          : undefined,
      },
    });
  } else if (event.type.startsWith("payout.")) {
    const payout = object as unknown as Stripe.Payout;
    await ctx.runMutation(internal.webhooks.apply, {
      ...base,
      payout: {
        id: payout.id,
        amountCents: payout.amount,
        currency: payout.currency,
        status: payout.status,
        failureCode: payout.failure_code ?? undefined,
        failureMessage: payout.failure_message ?? undefined,
        arrivalAt: payout.arrival_date ? payout.arrival_date * 1000 : undefined,
      },
    });
  } else {
    // account.updated carries only the account id that matters (see
    // payouts.reconcileAccount). Setup and payment-method events need no
    // projection, because Settings reads saved cards from Stripe. All are
    // recorded so delivery stays observable.
    await ctx.runMutation(internal.webhooks.apply, {
      ...base,
      accountId:
        event.type === "account.updated" ? (object.id as string) : undefined,
    });
  }
  return new Response(null, { status: 204 });
});

export const apply = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    connectedAccountId: v.optional(v.string()),
    intent: v.optional(
      v.object({
        id: v.string(),
        failureCode: v.optional(v.string()),
        customerId: v.optional(v.string()),
        paymentMethodId: v.optional(v.string()),
        savedForFuture: v.boolean(),
      }),
    ),
    refund: v.optional(
      v.object({
        id: v.string(),
        intentId: v.optional(v.string()),
        status: v.string(),
        failureReason: v.optional(v.string()),
      }),
    ),
    dispute: v.optional(
      v.object({
        id: v.string(),
        intentId: v.optional(v.string()),
        amountCents: v.number(),
        currency: v.string(),
        reason: v.string(),
        status: v.string(),
        evidenceDueAt: v.optional(v.number()),
      }),
    ),
    payout: v.optional(
      v.object({
        id: v.string(),
        amountCents: v.number(),
        currency: v.string(),
        status: v.string(),
        failureCode: v.optional(v.string()),
        failureMessage: v.optional(v.string()),
        arrivalAt: v.optional(v.number()),
      }),
    ),
    accountId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("stripeEvents")
      .withIndex("by_stripe_event", (q) => q.eq("stripeEventId", args.eventId))
      .first();
    if (seen) return;
    await ctx.db.insert("stripeEvents", {
      stripeEventId: args.eventId,
      type: args.type,
      connectedAccountId: args.connectedAccountId,
    });

    const attemptForIntent = (intentId: string | undefined) =>
      intentId
        ? ctx.db
            .query("paymentAttempts")
            .withIndex("by_intent", (q) =>
              q.eq("stripePaymentIntentId", intentId),
            )
            .first()
        : null;

    if (args.intent) {
      const attempt = await attemptForIntent(args.intent.id);
      if (!attempt) return;
      if (args.type === "payment_intent.succeeded") {
        await recordCaptured(ctx, attempt);
        const { customerId, paymentMethodId, savedForFuture } = args.intent;
        if (
          savedForFuture &&
          paymentMethodId &&
          customerId === attempt.stripeCustomerId
        ) {
          await ctx.db.patch(attempt._id, {
            savedPaymentMethodId: paymentMethodId,
          });
        }
      } else {
        await recordNotCaptured(
          ctx,
          attempt,
          args.type === "payment_intent.canceled" ? "CANCELED" : "FAILED",
          args.intent.failureCode,
        );
      }
      return;
    }

    if (args.refund) {
      const { id, intentId, status, failureReason } = args.refund;
      const refund =
        (await ctx.db
          .query("paymentRefunds")
          .withIndex("by_stripe_refund", (q) => q.eq("stripeRefundId", id))
          .first()) ??
        (intentId
          ? await ctx.db
              .query("paymentRefunds")
              .withIndex("by_intent", (q) =>
                q.eq("stripePaymentIntentId", intentId),
              )
              .first()
          : null);
      if (!refund) return;
      const next =
        status === "succeeded"
          ? "SUCCEEDED"
          : status === "failed" || status === "canceled"
            ? "FAILED"
            : "PENDING";
      // A final outcome is never reopened by an older event.
      if (
        (refund.status === "SUCCEEDED" || refund.status === "FAILED") &&
        next === "PENDING"
      ) {
        return;
      }
      await ctx.db.patch(refund._id, {
        stripeRefundId: refund.stripeRefundId ?? id,
        status: next,
        failureCode: failureReason,
        processedAt: next === "PENDING" ? refund.processedAt : Date.now(),
      });
      if (next === "SUCCEEDED") {
        await reverseForRefund(ctx, (await ctx.db.get(refund._id))!);
      }
      return;
    }

    if (args.dispute) {
      const { id, intentId, ...fields } = args.dispute;
      const attempt = await attemptForIntent(intentId);
      const existing = await ctx.db
        .query("paymentDisputes")
        .withIndex("by_stripe_dispute", (q) => q.eq("stripeDisputeId", id))
        .first();
      let disputeId = existing?._id;
      if (disputeId) {
        await ctx.db.patch(disputeId, {
          ...fields,
          paymentAttemptId: existing?.paymentAttemptId ?? attempt?._id,
          stripePaymentIntentId: existing?.stripePaymentIntentId ?? intentId,
        });
      } else {
        disputeId = await ctx.db.insert("paymentDisputes", {
          stripeDisputeId: id,
          paymentAttemptId: attempt?._id,
          stripePaymentIntentId: intentId,
          ...fields,
        });
      }
      await adjustForDispute(ctx, (await ctx.db.get(disputeId))!);
      return;
    }

    if (args.payout && args.connectedAccountId) {
      const connected = args.connectedAccountId;
      const account = await ctx.db
        .query("payoutAccounts")
        .withIndex("by_stripe_account", (q) =>
          q.eq("stripeAccountId", connected),
        )
        .first();
      if (!account) return;
      const { id, ...fields } = args.payout;
      const existing = await ctx.db
        .query("payoutEvents")
        .withIndex("by_stripe_payout", (q) => q.eq("stripePayoutId", id))
        .first();
      if (existing) await ctx.db.patch(existing._id, fields);
      else {
        await ctx.db.insert("payoutEvents", {
          stripePayoutId: id,
          creatorId: account.creatorId,
          ...fields,
        });
      }
      return;
    }

    if (args.accountId) {
      await ctx.scheduler.runAfter(0, internal.payouts.reconcileAccount, {
        stripeAccountId: args.accountId,
      });
    }
  },
});
