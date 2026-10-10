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

/**
 * A date in the viewer's time zone. Pass `calendarDay` for dates the server
 * stores as midnight UTC (the payout day), so they don't slip back a day in
 * the Americas.
 */
export function formatDate(value: string, { calendarDay = false } = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: calendarDay ? "UTC" : undefined,
  }).format(date);
}

export function formatSignedPrice(cents: number) {
  return `${cents < 0 ? "−" : "+"}${formatPrice(Math.abs(cents))}`;
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
