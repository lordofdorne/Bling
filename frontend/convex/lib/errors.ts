import { ConvexError } from "convex/values";

// Error codes match the Go API's, so the frontend can map them the same way
// while both backends exist. Throw with fail(code); the client reads
// error.data.code.
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "VALIDATION_FAILED"
  | "SHOW_NOT_FOUND"
  | "SHOW_NOT_LIVE"
  | "NO_LIVE_SHOW"
  | "ACTIVE_SHOW_EXISTS"
  | "INVALID_SHOW_STATE"
  | "SHOW_NOT_CONFIGURABLE"
  | "INVALID_TIER_CONFIGURATION"
  | "PAYOUT_SETUP_REQUIRED"
  | "TIER_NOT_FOUND"
  | "PAYMENT_REQUIRED"
  | "NOT_IN_QUEUE"
  | "INVALID_QUEUE_STATE"
  | "CALL_NOT_FOUND"
  | "CALLER_NOT_WAITING"
  | "QUEUE_EMPTY"
  | "ACTIVE_CALL_EXISTS"
  | "INVALID_CALL_STATE"
  | "PAYMENT_CAPTURE_FAILED"
  | "INVALID_SIGNAL"
  | "PAYMENTS_UNAVAILABLE"
  | "TIER_NOT_PAYABLE"
  | "PAYMENT_NOT_AUTHORIZED"
  | "PAYMENT_PROVIDER_ERROR"
  | "PAYMENT_METHOD_NOT_FOUND"
  | "PAYOUTS_UNAVAILABLE"
  | "PAYOUT_PROVIDER_ERROR"
  | "CREATOR_NOT_FOUND"
  | "SELF_FOLLOW"
  | "FOLLOW_LIMIT"
  | "RATE_LIMITED"
  | "INVALID_AVATAR";

export function fail(code: ErrorCode, message?: string): never {
  throw new ConvexError({ code, message: message ?? code });
}
