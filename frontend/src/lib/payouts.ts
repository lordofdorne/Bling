import { usingConvex } from "./backend";
import * as convexHooks from "./convex/hooks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api";

export type PayoutStatus = {
  connected: boolean;
  /**
   * Stripe v2 `stripe_balance.stripe_transfers` capability status: "active",
   * "pending", "restricted" or "unsupported". Only "active" permits paid calls.
   */
  transfersStatus: string;
  bankPayoutsStatus: string;
  externalAccountPresent: boolean;
  externalAccountBankName?: string;
  externalAccountLast4?: string;
  externalAccountCurrency?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  ready: boolean;
  requirementsDue: string[];
  platformFeePercent: number;
  creatorProcessingFeePercent: number;
};

type StatusResponse = { data: { payouts: PayoutStatus } };
export type CreatorBalance = {
  currency: string;
  totalCents: number;
  pendingCents: number;
  availableCents: number;
  nextPayoutAt?: string;
};
export type LedgerEntry = {
  /** A number from the Go API, a document id from Convex. */
  id: number | string;
  kind: string;
  amountCents: number;
  currency: string;
  effectiveAt: string;
  createdAt: string;
};
/** Net earnings on one UTC day (`YYYY-MM-DD`); quiet days are left out. */
export type EarningsDay = { date: string; cents: number };
export type CreatorEarnings = { currency: string; days: EarningsDay[] };
type BalanceResponse = {
  data: { balance: CreatorBalance; activity: LedgerEntry[] };
};
export type PayoutAccountSession = {
  clientSecret: string;
  publishableKey: string;
};
type SessionResponse = { data: { accountSession: PayoutAccountSession } };

const payoutKey = ["payouts", "account"] as const;

function usePayoutStatusGo() {
  return useQuery({
    queryKey: payoutKey,
    queryFn: async () =>
      (await apiRequest<StatusResponse>("/api/v1/payouts/account")).data
        .payouts,
    staleTime: 5_000,
  });
}

function useCreatorBalanceGo() {
  return useQuery({
    queryKey: ["payouts", "balance"],
    queryFn: async () =>
      (await apiRequest<BalanceResponse>("/api/v1/payouts/balance")).data,
    staleTime: 5_000,
  });
}

// Ledger kinds that change what a creator earned (payouts only move it).
const EARNING_KINDS = new Set([
  "EARNING",
  "REFUND_REVERSAL",
  "DISPUTE_DEBIT",
  "DISPUTE_RELEASE",
]);

/**
 * The Go API has no earnings series, so this builds one from the recent
 * balance activity it does return. Close enough while Go is being retired.
 */
function useCreatorEarningsGo(days: number) {
  return useQuery({
    queryKey: ["payouts", "balance"],
    queryFn: async () =>
      (await apiRequest<BalanceResponse>("/api/v1/payouts/balance")).data,
    staleTime: 5_000,
    select: ({ balance, activity }): CreatorEarnings => {
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      since.setUTCDate(since.getUTCDate() - (days - 1));
      const totals = new Map<string, number>();
      for (const entry of activity) {
        const earned = new Date(entry.createdAt);
        if (!EARNING_KINDS.has(entry.kind) || earned < since) continue;
        const day = earned.toISOString().slice(0, 10);
        totals.set(day, (totals.get(day) ?? 0) + entry.amountCents);
      }
      return {
        currency: balance.currency,
        days: [...totals]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, cents]) => ({ date, cents })),
      };
    },
  });
}

async function fetchPayoutAccountSessionGo() {
  return (
    await apiRequest<SessionResponse>("/api/v1/payouts/account-session", {
      method: "POST",
    })
  ).data.accountSession;
}

function usePayoutAccountSessionGo() {
  return useMutation({ mutationFn: fetchPayoutAccountSession });
}

// The Convex build swaps in src/lib/convex/hooks.ts (see lib/backend.ts).
export const usePayoutStatus = usingConvex
  ? convexHooks.usePayoutStatus
  : usePayoutStatusGo;
export const useCreatorBalance = usingConvex
  ? convexHooks.useCreatorBalance
  : useCreatorBalanceGo;
export const useCreatorEarnings = usingConvex
  ? convexHooks.useCreatorEarnings
  : useCreatorEarningsGo;
export const fetchPayoutAccountSession = usingConvex
  ? convexHooks.fetchPayoutAccountSession
  : fetchPayoutAccountSessionGo;
export const usePayoutAccountSession = usingConvex
  ? convexHooks.usePayoutAccountSession
  : usePayoutAccountSessionGo;
