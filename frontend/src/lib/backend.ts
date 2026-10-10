import { ConvexQueryClient } from "@convex-dev/react-query";
import { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { ApiError } from "./api";

// Which backend the app talks to, fixed at build time. `VITE_BACKEND=convex`
// (with VITE_CONVEX_URL) switches every hook in src/lib to Convex; anything
// else keeps the Go API. Sign-in lives in one backend or the other, so the
// switch is all or nothing (docs/convex-migration.md, phase 6).
export const usingConvex =
  import.meta.env.VITE_BACKEND === "convex" &&
  Boolean(import.meta.env.VITE_CONVEX_URL);

export const convex: ConvexReactClient | null = usingConvex
  ? new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)
  : null;

/** Feeds live Convex queries into TanStack Query (see main.tsx). */
export const convexQueryClient = convex ? new ConvexQueryClient(convex) : null;

export function convexClient(): ConvexReactClient {
  if (!convex) throw new Error("Convex is not configured.");
  return convex;
}

// Convex functions throw ConvexError({ code, message }) with the Go API's
// codes. The UI shows ApiError messages, so codes map to the same wording
// the Go API used.
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Sign in to continue.",
  VALIDATION_FAILED: "Check the details and try again.",
  SHOW_NOT_FOUND: "Show not found.",
  SHOW_NOT_LIVE: "This Hotline is not live.",
  ACTIVE_SHOW_EXISTS: "You already have a live show.",
  INVALID_SHOW_STATE: "This show cannot make that transition.",
  SHOW_NOT_CONFIGURABLE: "Tiers can only be changed before the Hotline starts.",
  INVALID_TIER_CONFIGURATION:
    "Use 1-5 uniquely named tiers, keep one enabled, and check price and duration values.",
  PAYOUT_SETUP_REQUIRED:
    "Finish payout setup before starting a Hotline with paid tiers.",
  TIER_NOT_FOUND: "That call tier is unavailable.",
  PAYMENT_REQUIRED: "Authorize payment for this tier before joining.",
  NOT_IN_QUEUE: "You are not in this queue.",
  INVALID_QUEUE_STATE: "This queue entry can no longer leave.",
  CALL_NOT_FOUND: "Call not found.",
  CALLER_NOT_WAITING: "That caller is no longer waiting.",
  QUEUE_EMPTY: "There are no callers waiting.",
  ACTIVE_CALL_EXISTS: "End the active call before choosing another caller.",
  INVALID_CALL_STATE: "That call status change is not allowed.",
  PAYMENT_CAPTURE_FAILED:
    "Payment could not be captured. The call was not opened.",
  INVALID_SIGNAL: "Call signaling failed.",
  PAYMENTS_UNAVAILABLE: "Payments are not configured right now.",
  TIER_NOT_PAYABLE: "That paid tier is unavailable.",
  PAYMENT_NOT_AUTHORIZED: "Payment was not authorized. Try again.",
  PAYMENT_PROVIDER_ERROR: "Stripe could not process the payment. Try again.",
  PAYMENT_METHOD_NOT_FOUND: "That payment method is no longer available.",
  PAYOUTS_UNAVAILABLE: "Creator payouts are not configured right now.",
  PAYOUT_PROVIDER_ERROR:
    "Stripe could not update your payout account. Try again.",
  CREATOR_NOT_FOUND: "That creator could not be found.",
  SELF_FOLLOW: "You cannot follow yourself.",
  FOLLOW_LIMIT: "You can follow up to 1000 creators.",
  RATE_LIMITED: "Too many attempts. Please try again shortly.",
  INVALID_AVATAR: "Choose a JPG, PNG, or WebP image smaller than 768 KB.",
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  EMAIL_TAKEN: "An account already uses that email.",
  PASSWORD_RESET_UNAVAILABLE:
    "Password reset is not available yet. Contact support for help.",
};

export function toApiError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause;
  if (cause instanceof ConvexError) {
    const data = cause.data as { code?: string; message?: string } | string;
    const code = typeof data === "object" ? (data.code ?? "") : "";
    const sent = typeof data === "object" ? data.message : data;
    // A message that is just the code is not meant for people.
    const message =
      MESSAGES[code] ??
      (sent && sent !== code
        ? sent
        : "Something went wrong. Please try again.");
    return new ApiError(400, code || "REQUEST_FAILED", message);
  }
  return new ApiError(
    0,
    "REQUEST_FAILED",
    "Unable to connect. Please try again.",
  );
}

async function mapped<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (cause) {
    throw toApiError(cause);
  }
}

export function runQuery<F extends FunctionReference<"query">>(
  fn: F,
  args: FunctionArgs<F>,
): Promise<FunctionReturnType<F>> {
  return mapped(convexClient().query(fn, args));
}

export function runMutation<F extends FunctionReference<"mutation">>(
  fn: F,
  args: FunctionArgs<F>,
): Promise<FunctionReturnType<F>> {
  return mapped(convexClient().mutation(fn, args));
}

export function runAction<F extends FunctionReference<"action">>(
  fn: F,
  args: FunctionArgs<F>,
): Promise<FunctionReturnType<F>> {
  return mapped(convexClient().action(fn, args));
}

/** Convex timestamps are milliseconds; the app's types use ISO strings. */
export const iso = (ms: number | undefined | null) =>
  ms === undefined || ms === null ? null : new Date(ms).toISOString();
