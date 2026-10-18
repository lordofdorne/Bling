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

// Fees, ported from backend/internal/payment/store.go. The creator gets their
// share of the price less half of Stripe's published basic domestic card fee
// (2.9% + 30¢); Bling keeps the rest and absorbs the other half of the card
// fee, including the odd cent.
//
// Each creator's platform fee is fixed on their user record when they sign
// up. While Bling is in beta, new creators pay 10% and keep 90%. To end the
// beta, set SIGNUP_PLATFORM_FEE_BPS to STANDARD_PLATFORM_FEE_BPS: new creators
// then keep 80%, and beta creators keep the rate they joined with.
export const STANDARD_PLATFORM_FEE_BPS = 2000;
export const BETA_PLATFORM_FEE_BPS = 1000;
export const SIGNUP_PLATFORM_FEE_BPS = BETA_PLATFORM_FEE_BPS;

/**
 * A creator's platform fee. Accounts made before rates were stored all joined
 * during the beta, so a missing rate is the beta rate.
 */
export function creatorFeeBps(creator: { platformFeeBps?: number } | null) {
  return creator?.platformFeeBps ?? BETA_PLATFORM_FEE_BPS;
}
const BASIC_CARD_FEE_BPS = 290;
const BASIC_CARD_FIXED_FEE_CENTS = 30;
const CREATOR_PROCESSING_FEE_SHARE_BPS = 5000;

export function paymentFees(amountCents: number, platformFeeBps: number) {
  const basicCardFeeCents =
    Math.floor((amountCents * BASIC_CARD_FEE_BPS + 5000) / 10000) +
    BASIC_CARD_FIXED_FEE_CENTS;
  const creatorProcessingFeeCents = Math.floor(
    (basicCardFeeCents * CREATOR_PROCESSING_FEE_SHARE_BPS) / 10000,
  );
  const creatorShareBps = 10000 - platformFeeBps;
  const platformFeeCents =
    amountCents -
    Math.floor((amountCents * creatorShareBps) / 10000) +
    creatorProcessingFeeCents;
  return {
    platformFeeBps,
    platformFeeCents,
    basicCardFeeCents,
    creatorProcessingFeeCents,
  };
}
