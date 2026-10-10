// Facts about the site that its policies and contact pages state. Change
// them here; every page reads from this file.

export const SITE = {
  name: "Bling",
  url: "https://blinghotline.com",
  /** Placeholder until a support inbox is chosen. */
  supportEmail: "support@blinghotline.com",
  /** The legal entity that operates Bling, as it should appear in policies. */
  operator: "Bling",
  policiesEffective: "October 10, 2026",
} as const;

// Numbers the policies quote. They match the backend's defaults
// (convex/lib/stripe.ts fees, convex/payouts.ts and convex/lib/ledger.ts).
export const PAYOUT_TERMS = {
  creatorSharePercent: 80,
  platformSharePercent: 20,
  earningsHoldDays: 7,
  payoutMinimumDollars: 25,
  payoutDayOfMonth: 1,
} as const;
