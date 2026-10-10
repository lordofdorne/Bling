import Stripe from "stripe";
import { fail } from "./errors";

// Stripe access for actions. Uses the SDK's fetch-based worker build, which
// runs in Convex's default runtime, so no "use node" file is needed.
//
// Environment (npx convex env set): STRIPE_SECRET_KEY,
// STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, and
// STRIPE_CONNECT_WEBHOOK_SECRET. Stripe sends events about Bling's own
// account (payments, refunds, disputes) and about creators' connected
// accounts (account updates, payouts) through separate destinations, each
// with its own signing secret; both point at the same URL.
//
// Tests replace this module with vi.mock, so nothing here talks to Stripe in
// the test suite.

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) fail("PAYMENTS_UNAVAILABLE");
  return new Stripe(key, { maxNetworkRetries: 2 });
}

export function publishableKey(): string {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) fail("PAYMENTS_UNAVAILABLE");
  return key;
}

/** Signing secrets the webhook accepts; empty when webhooks are off. */
export function webhookSecrets(): string[] {
  return [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  ].filter((secret): secret is string => !!secret);
}

/**
 * Whether a failed Stripe call may succeed if repeated with the same
 * idempotency key: network trouble, rate limits and Stripe-side errors.
 * Card declines and invalid requests will not.
 */
export function isTransientStripeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { type, statusCode } = error as { type?: string; statusCode?: number };
  return (
    type === "StripeConnectionError" ||
    type === "StripeRateLimitError" ||
    type === "StripeAPIError" ||
    (statusCode !== undefined && statusCode >= 500)
  );
}

// Fees, ported unchanged from backend/internal/payment/store.go. The creator
// gets 80% of the price less half of Stripe's published basic domestic card
// fee (2.9% + 30¢); Bling keeps 20% and absorbs the other half, including the
// odd cent.
export const PLATFORM_FEE_BPS = 2000;
const BASIC_CARD_FEE_BPS = 290;
const BASIC_CARD_FIXED_FEE_CENTS = 30;
const CREATOR_PROCESSING_FEE_SHARE_BPS = 5000;

export function paymentFees(amountCents: number) {
  const basicCardFeeCents =
    Math.floor((amountCents * BASIC_CARD_FEE_BPS + 5000) / 10000) +
    BASIC_CARD_FIXED_FEE_CENTS;
  const creatorProcessingFeeCents = Math.floor(
    (basicCardFeeCents * CREATOR_PROCESSING_FEE_SHARE_BPS) / 10000,
  );
  const creatorShareBps = 10000 - PLATFORM_FEE_BPS;
  const platformFeeCents =
    amountCents -
    Math.floor((amountCents * creatorShareBps) / 10000) +
    creatorProcessingFeeCents;
  return {
    platformFeeBps: PLATFORM_FEE_BPS,
    platformFeeCents,
    basicCardFeeCents,
    creatorProcessingFeeCents,
  };
}
