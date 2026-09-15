import type { PaymentActivity } from "../../lib/finance";

export const MINIMUM_PAID_TIER_CENTS = 50;
export const DEFAULT_PAID_TIER_CENTS = 500;

export function formatPrice(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatCallLength(seconds: number) {
  const minutes = seconds / 60;
  return `${Number(minutes.toFixed(2))} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatSignedPrice(cents: number) {
  return `${cents < 0 ? "−" : "+"}${formatPrice(Math.abs(cents))}`;
}

export function activityLabel(activity: PaymentActivity) {
  if (activity.disputeStatus) return `Dispute: ${activity.disputeStatus}`;
  if (activity.refundStatus === "SUCCEEDED") return "Refunded";
  if (activity.refundStatus === "FAILED") return "Refund needs attention";
  if (activity.refundStatus) return "Refund in progress";
  return "Paid call";
}

export function durationInputFromSeconds(seconds: number) {
  return Number((seconds / 60).toFixed(2)).toString();
}

export function priceInputFromCents(cents: number) {
  return (cents / 100).toFixed(2);
}

export function centsFromPriceInput(value: string) {
  if (!/^\d*(?:\.\d{0,2})?$/.test(value)) return null;
  if (value === "" || value === ".") return 0;
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars > 10_000) return null;
  return Math.round(dollars * 100);
}

export function estimatedCreatorEarningsCents(amountCents: number) {
  const basicCardFeeCents = Math.round(amountCents * 0.029) + 30;
  const creatorCardFeeCents = Math.floor(basicCardFeeCents / 2);
  return Math.max(0, Math.floor(amountCents * 0.8) - creatorCardFeeCents);
}

// The ledger kinds the balance API can return, in plain language. Creators see
// money moving; they should not have to read the raw enum.
export const LEDGER_LABELS: Record<string, string> = {
  EARNING: "Call earning",
  REFUND_REVERSAL: "Refund reversal",
  DISPUTE_DEBIT: "Dispute hold",
  DISPUTE_RELEASE: "Dispute released",
  PAYOUT_RESERVATION: "Reserved for payout",
  PAYOUT_RELEASE: "Returned to balance",
  ADJUSTMENT: "Adjustment",
};
