// Facts about the site that its policies and contact pages state. Change
// them here; every page reads from this file.

export const SITE = {
  name: "Bling",
  url: "https://blinghotline.com",
  /** Policies, contact page and account deletion all point here. */
  supportEmail: "blinghotlinesupport@gmail.com",
  /** The legal entity that operates Bling, as it should appear in policies. */
  operator: "Bling",
  policiesEffective: "October 10, 2026",
  /**
   * Bling's own social accounts, linked from the footer. Fill in a URL to
   * show its link; empty ones are hidden.
   */
  social: {
    instagram: "",
    tiktok: "",
    x: "",
    youtube: "",
  },
} as const;

/**
 * Bling is in beta. Creators who sign up now keep a bigger share of each
 * paid call; convex/lib/stripe.ts fixes that rate on their account. When the
 * beta ends, turn this off and switch SIGNUP_PLATFORM_FEE_BPS there.
 */
export const BETA = {
  active: true,
  creatorSharePercent: 90,
  platformSharePercent: 10,
} as const;

// Numbers the policies quote. They match the backend's defaults
// (convex/lib/stripe.ts fees, convex/payouts.ts and convex/lib/ledger.ts).
export const PAYOUT_TERMS = {
  /** The standard share, for creators who join after the beta. */
  creatorSharePercent: 80,
  platformSharePercent: 20,
  earningsHoldDays: 7,
  payoutMinimumDollars: 25,
  payoutDayOfMonth: 1,
} as const;

/**
 * What a creator keeps from a paid call, in cents: their share of the price
 * less half of Stripe's basic card fee (2.9% + 30¢). Mirrors paymentFees in
 * convex/lib/stripe.ts, which can't be imported here because it loads the
 * Stripe SDK; convex/payments.test.ts checks the two agree.
 */
export function creatorTakeHomeCents(
  priceCents: number,
  creatorSharePercent: number,
) {
  const cardFeeCents = Math.floor((priceCents * 290 + 5000) / 10000) + 30;
  return (
    Math.floor((priceCents * creatorSharePercent * 100) / 10000) -
    Math.floor(cardFeeCents / 2)
  );
}
