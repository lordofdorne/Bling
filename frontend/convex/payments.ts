import { v } from "convex/values";
import type Stripe from "stripe";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { requireCreatorId, requireUserId } from "./lib/auth";
import { fail } from "./lib/errors";
import { recordCaptured, recordNotCaptured } from "./lib/payments";
import {
  isTransientStripeError,
  creatorFeeBps,
  paymentFees,
  publishableKey,
  stripeClient,
} from "./lib/stripe";
import { ensureCustomer } from "./paymentMethods";

// Paid tiers. Ported from backend/internal/payment.
//
//   1. authorize: the caller gets a PaymentIntent with manual capture and
//      confirms it in the browser, so Stripe holds the tier price.
//   2. queue.joinPaid: Bling checks the hold with Stripe and adds the caller.
//   3. calls.select: the creator picks them; the call waits in
//      PAYMENT_PENDING while capture runs, then opens. A failed capture
//      releases the caller; a call that never goes live is refunded.
//
// Mutations cannot call Stripe, so each step records its intent in a mutation
// and schedules an action. Every Stripe request carries an idempotency key,
// so a repeated action never charges twice.

/** Capture attempts before a pending capture is left to the webhook. */
const MAX_CAPTURE_TRIES = 5;

async function stripeCall<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    console.error("Stripe request failed", (error as Error).message);
    fail("PAYMENT_PROVIDER_ERROR");
  }
}

// ------------------------------------------------------------ authorize

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Where Stripe sends the fan's receipt (and any refund notice): their account
 * email, or the one a guest typed in. Bling passes it to Stripe and does not
 * store it.
 */
function receiptEmailFor(accountEmail: string | undefined, given?: string) {
  if (accountEmail) return accountEmail;
  const email = given?.trim().toLowerCase();
  if (!email) return undefined;
  if (email.length > 254 || !EMAIL.test(email)) {
    fail("VALIDATION_FAILED", "Enter a valid email for your receipt.");
  }
  return email;
}

/** Starts (or resumes, for the same idempotency key) a hold for a tier. */
export const authorize = action({
  args: {
    showId: v.id("shows"),
    tierId: v.id("showTiers"),
    idempotencyKey: v.string(),
    receiptEmail: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    attemptId: Id<"paymentAttempts">;
    clientSecret: string;
    publishableKey: string;
    amountCents: number;
    currency: string;
    customerSessionClientSecret?: string;
  }> => {
    if (args.idempotencyKey.length < 8 || args.idempotencyKey.length > 200) {
      fail("VALIDATION_FAILED", "A payment idempotency key is required.");
    }
    const stripe = stripeClient();
    const key = publishableKey();
    const payer = await ctx.runQuery(internal.payments.payer, {});
    const receiptEmail = receiptEmailFor(payer.email, args.receiptEmail);
    // Signed-in callers get a Stripe customer so they can reuse saved cards.
    const stripeCustomerId = payer.email
      ? await ensureCustomer(ctx, stripe, payer.userId, payer.email)
      : undefined;
    const attempt = await ctx.runMutation(internal.payments.prepare, {
      showId: args.showId,
      tierId: args.tierId,
      idempotencyKey: args.idempotencyKey,
      stripeCustomerId,
    });
    const details = await ctx.runQuery(internal.payments.receiptDetails, {
      showId: attempt.showId,
      tierId: attempt.tierId,
    });

    let intent: Stripe.PaymentIntent;
    if (attempt.stripePaymentIntentId) {
      const intentId = attempt.stripePaymentIntentId;
      intent = await stripeCall(() => stripe.paymentIntents.retrieve(intentId));
      // A guest who retries with a corrected email gets the receipt there.
      if (receiptEmail && intent.receipt_email !== receiptEmail) {
        intent = await stripeCall(() =>
          stripe.paymentIntents.update(intentId, {
            receipt_email: receiptEmail,
          }),
        );
      }
    } else {
      intent = await stripeCall(() =>
        stripe.paymentIntents.create(
          {
            amount: attempt.amountCents,
            currency: attempt.currency,
            capture_method: "manual",
            payment_method_types: ["card", "link"],
            // Shown on the Stripe receipt the fan gets once they're charged.
            description: `Call with @${details.username} · ${details.tierName} (${details.minutes} min)`,
            receipt_email: receiptEmail,
            customer: attempt.stripeCustomerId,
            metadata: {
              bling_payment_attempt_id: attempt._id,
              bling_show_id: attempt.showId,
              bling_tier_id: attempt.tierId,
            },
          },
          { idempotencyKey: `bling-payment-create-${attempt._id}` },
        ),
      );
      await ctx.runMutation(internal.payments.attachIntent, {
        attemptId: attempt._id,
        intentId: intent.id,
      });
    }

    let customerSessionClientSecret: string | undefined;
    if (attempt.stripeCustomerId) {
      const customer = attempt.stripeCustomerId;
      const session = await stripeCall(() =>
        stripe.customerSessions.create({
          customer,
          components: {
            payment_element: {
              enabled: true,
              features: {
                payment_method_redisplay: "enabled",
                payment_method_redisplay_limit: 5,
                payment_method_remove: "enabled",
                payment_method_save: "enabled",
                payment_method_save_usage: "on_session",
              },
            },
          },
        }),
      );
      customerSessionClientSecret = session.client_secret;
    }
    return {
      attemptId: attempt._id,
      clientSecret: intent.client_secret!,
      publishableKey: key,
      amountCents: attempt.amountCents,
      currency: attempt.currency,
      customerSessionClientSecret,
    };
  },
});

export const payer = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    return {
      userId,
      email: user && !user.isAnonymous ? user.email : undefined,
    };
  },
});

/** What a fan's receipt says they paid for. */
export const receiptDetails = internalQuery({
  args: { showId: v.id("shows"), tierId: v.id("showTiers") },
  handler: async (ctx, { showId, tierId }) => {
    const show = await ctx.db.get(showId);
    const tier = await ctx.db.get(tierId);
    const creator = show && (await ctx.db.get(show.creatorId));
    return {
      username: creator?.username ?? "creator",
      tierName: tier?.name ?? "Hotline call",
      minutes: Number(((tier?.callDurationSeconds ?? 0) / 60).toFixed(2)),
    };
  },
});

export const prepare = internalMutation({
  args: {
    showId: v.id("shows"),
    tierId: v.id("showTiers"),
    idempotencyKey: v.string(),
    stripeCustomerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const payerId = await requireUserId(ctx);
    const show = await ctx.db.get(args.showId);
    const tier = await ctx.db.get(args.tierId);
    if (!show || !tier || tier.showId !== show._id || !tier.enabled) {
      fail("TIER_NOT_PAYABLE");
    }
    if (show.status !== "LIVE") fail("SHOW_NOT_LIVE");
    if (tier.priceCents <= 0) fail("TIER_NOT_PAYABLE");

    // The same key always resumes the same attempt, and only for the same
    // caller, tier and customer.
    const existing = await ctx.db
      .query("paymentAttempts")
      .withIndex("by_show_key", (q) =>
        q.eq("showId", show._id).eq("idempotencyKey", args.idempotencyKey),
      )
      .first();
    if (existing) {
      if (
        existing.payerId !== payerId ||
        existing.tierId !== tier._id ||
        existing.stripeCustomerId !== args.stripeCustomerId
      ) {
        fail("PAYMENT_NOT_AUTHORIZED");
      }
      return existing;
    }
    const attemptId = await ctx.db.insert("paymentAttempts", {
      showId: show._id,
      creatorId: show.creatorId,
      tierId: tier._id,
      payerId,
      idempotencyKey: args.idempotencyKey,
      stripeCustomerId: args.stripeCustomerId,
      amountCents: tier.priceCents,
      currency: "usd",
      ...paymentFees(
        tier.priceCents,
        creatorFeeBps(await ctx.db.get(show.creatorId)),
      ),
      status: "CREATED",
    });
    return (await ctx.db.get(attemptId))!;
  },
});

export const attachIntent = internalMutation({
  args: { attemptId: v.id("paymentAttempts"), intentId: v.string() },
  handler: async (ctx, { attemptId, intentId }) => {
    const attempt = await ctx.db.get(attemptId);
    if (!attempt) fail("PAYMENT_NOT_AUTHORIZED");
    if (attempt.stripePaymentIntentId === intentId) return;
    if (attempt.stripePaymentIntentId) fail("PAYMENT_NOT_AUTHORIZED");
    await ctx.db.patch(attemptId, { stripePaymentIntentId: intentId });
  },
});

// ------------------------------------------------------------ verify

/**
 * Confirms with Stripe that the caller's hold is in place, unless Bling
 * already knows. Called by queue.joinPaid before adding the caller.
 */
export async function verifyAuthorization(
  ctx: ActionCtx,
  showId: Id<"shows">,
  attemptId: Id<"paymentAttempts">,
) {
  const attempt = await ctx.runQuery(internal.payments.attemptForPayer, {
    showId,
    attemptId,
  });
  if (attempt.status === "AUTHORIZED") return;
  if (attempt.status !== "CREATED" || !attempt.stripePaymentIntentId) {
    fail("PAYMENT_NOT_AUTHORIZED");
  }
  const intentId = attempt.stripePaymentIntentId;
  const intent = await stripeCall(() =>
    stripeClient().paymentIntents.retrieve(intentId),
  );
  // PLATFORM flow: the hold must be for exactly this amount, held by Bling,
  // with no destination or application fee.
  const matches =
    intent.status === "requires_capture" &&
    intent.amount === attempt.amountCents &&
    intent.currency === attempt.currency &&
    !intent.transfer_data &&
    !intent.application_fee_amount;
  if (!matches) fail("PAYMENT_NOT_AUTHORIZED");
  await ctx.runMutation(internal.payments.markAuthorized, { attemptId });
}

export const attemptForPayer = internalQuery({
  args: { showId: v.id("shows"), attemptId: v.id("paymentAttempts") },
  handler: async (ctx, { showId, attemptId }) => {
    const payerId = await requireUserId(ctx);
    const attempt = await ctx.db.get(attemptId);
    if (attempt?.showId !== showId || attempt.payerId !== payerId) {
      fail("PAYMENT_NOT_AUTHORIZED");
    }
    return attempt;
  },
});

export const markAuthorized = internalMutation({
  args: { attemptId: v.id("paymentAttempts") },
  handler: async (ctx, { attemptId }) => {
    const attempt = await ctx.db.get(attemptId);
    if (attempt?.status === "CREATED") {
      await ctx.db.patch(attemptId, {
        status: "AUTHORIZED",
        authorizedAt: Date.now(),
      });
    }
  },
});

// ------------------------------------------------------------ capture

/** Scheduled by calls.select for a paid caller. */
export const capture = internalAction({
  args: { callId: v.id("calls"), tries: v.optional(v.number()) },
  handler: async (ctx, { callId, tries = 0 }) => {
    const pending = await ctx.runQuery(internal.payments.pendingCapture, {
      callId,
    });
    if (!pending) return;
    const stripe = stripeClient();
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.capture(
        pending.intentId,
        {},
        { idempotencyKey: `bling-payment-capture-${callId}` },
      );
    } catch (error) {
      if (isTransientStripeError(error) && tries + 1 < MAX_CAPTURE_TRIES) {
        await ctx.scheduler.runAfter(
          1000 * 2 ** tries,
          internal.payments.capture,
          { callId, tries: tries + 1 },
        );
        return;
      }
      if (isTransientStripeError(error)) {
        // Still unknown. The payment_intent webhook (or the sweep) settles it.
        console.error("Capture outcome unknown", (error as Error).message);
        return;
      }
      intent = await stripe.paymentIntents.retrieve(pending.intentId);
    }
    if (intent.status === "succeeded") {
      await ctx.runMutation(internal.payments.captured, {
        attemptId: pending.attemptId,
      });
      return;
    }
    // Not captured. Release the hold, then fail the call. If the release
    // itself fails, the call stays pending until Stripe's webhook decides.
    if (intent.status !== "canceled") {
      try {
        await stripe.paymentIntents.cancel(
          pending.intentId,
          {},
          {
            idempotencyKey: `bling-payment-cancel-${pending.intentId}-capture`,
          },
        );
      } catch (error) {
        console.error(
          "Release after failed capture failed",
          (error as Error).message,
        );
        return;
      }
    }
    await ctx.runMutation(internal.payments.notCaptured, {
      attemptId: pending.attemptId,
      status: "FAILED",
      failureCode: "capture_failed",
    });
  },
});

export const pendingCapture = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const call = await ctx.db.get(callId);
    if (call?.status !== "PAYMENT_PENDING" || !call.paymentAttemptId) {
      return null;
    }
    const attempt = await ctx.db.get(call.paymentAttemptId);
    if (attempt?.status !== "CAPTURING" || !attempt.stripePaymentIntentId) {
      return null;
    }
    return { attemptId: attempt._id, intentId: attempt.stripePaymentIntentId };
  },
});

export const captured = internalMutation({
  args: { attemptId: v.id("paymentAttempts") },
  handler: async (ctx, { attemptId }) => {
    const attempt = await ctx.db.get(attemptId);
    if (attempt) await recordCaptured(ctx, attempt);
  },
});

export const notCaptured = internalMutation({
  args: {
    attemptId: v.id("paymentAttempts"),
    status: v.union(v.literal("CANCELED"), v.literal("FAILED")),
    failureCode: v.optional(v.string()),
  },
  handler: async (ctx, { attemptId, status, failureCode }) => {
    const attempt = await ctx.db.get(attemptId);
    if (attempt) await recordNotCaptured(ctx, attempt, status, failureCode);
  },
});

// ------------------------------------------------------------ release

/** Releases a hold that will never be captured (caller left, show ended). */
export const cancelIntent = internalAction({
  args: { attemptId: v.id("paymentAttempts"), reason: v.string() },
  handler: async (ctx, { attemptId, reason }) => {
    const attempt: Doc<"paymentAttempts"> | null = await ctx.runQuery(
      internal.payments.attempt,
      { attemptId },
    );
    if (
      !attempt?.stripePaymentIntentId ||
      (attempt.status !== "CREATED" && attempt.status !== "AUTHORIZED")
    ) {
      return;
    }
    const stripe = stripeClient();
    const intentId = attempt.stripePaymentIntentId;
    try {
      await stripe.paymentIntents.cancel(
        intentId,
        {},
        { idempotencyKey: `bling-payment-cancel-${intentId}-${reason}` },
      );
    } catch (error) {
      // Already canceled (or never confirmed) is fine; anything else is
      // settled later by the payment_intent.canceled webhook, and an
      // uncaptured hold lapses on its own after seven days.
      const intent = await stripe.paymentIntents.retrieve(intentId);
      if (intent.status !== "canceled") {
        console.error(
          "Releasing a payment hold failed",
          (error as Error).message,
        );
        return;
      }
    }
    await ctx.runMutation(internal.payments.notCaptured, {
      attemptId,
      status: "CANCELED",
    });
  },
});

export const attempt = internalQuery({
  args: { attemptId: v.id("paymentAttempts") },
  handler: (ctx, { attemptId }) => ctx.db.get(attemptId),
});

// ------------------------------------------------------------ creator view

/** The creator's recent paid calls with any refund or dispute. */
export const activity = query({
  args: {},
  handler: async (ctx) => {
    const creatorId = await requireCreatorId(ctx);
    const results = [];
    for await (const attempt of ctx.db
      .query("paymentAttempts")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .order("desc")) {
      if (attempt.status !== "CAPTURED" && attempt.status !== "CAPTURING") {
        continue;
      }
      const refund = await ctx.db
        .query("paymentRefunds")
        .withIndex("by_attempt", (q) => q.eq("paymentAttemptId", attempt._id))
        .first();
      const dispute = await ctx.db
        .query("paymentDisputes")
        .withIndex("by_attempt", (q) => q.eq("paymentAttemptId", attempt._id))
        .order("desc")
        .first();
      results.push({
        paymentAttemptId: attempt._id,
        amountCents: attempt.amountCents,
        platformFeeCents: attempt.platformFeeCents,
        basicCardFeeCents: attempt.basicCardFeeCents,
        creatorProcessingFeeCents: attempt.creatorProcessingFeeCents,
        currency: attempt.currency,
        paymentStatus: attempt.status,
        refundStatus: refund?.status,
        refundReason: refund?.reason,
        disputeStatus: dispute?.status,
        disputeReason: dispute?.reason,
        createdAt: attempt._creationTime,
      });
      if (results.length === 50) break;
    }
    return results;
  },
});

/** Safety net for captures whose action died; run by the payments sweep. */
export const stalledCaptures = internalQuery({
  args: { olderThan: v.number() },
  handler: async (ctx, { olderThan }) => {
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_status", (q) => q.eq("status", "PAYMENT_PENDING"))
      .take(100);
    return calls
      .filter((call) => call._creationTime < olderThan)
      .map((call) => call._id);
  },
});
