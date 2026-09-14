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
  id: number;
  kind: string;
  amountCents: number;
  currency: string;
  effectiveAt: string;
  createdAt: string;
};
type BalanceResponse = {
  data: { balance: CreatorBalance; activity: LedgerEntry[] };
};
export type PayoutAccountSession = {
  clientSecret: string;
  publishableKey: string;
};
type SessionResponse = { data: { accountSession: PayoutAccountSession } };

const payoutKey = ["payouts", "account"] as const;

export function usePayoutStatus() {
  return useQuery({
    queryKey: payoutKey,
    queryFn: async () =>
      (await apiRequest<StatusResponse>("/api/v1/payouts/account")).data
        .payouts,
    staleTime: 5_000,
  });
}

export function useCreatorBalance() {
  return useQuery({
    queryKey: ["payouts", "balance"],
    queryFn: async () =>
      (await apiRequest<BalanceResponse>("/api/v1/payouts/balance")).data,
    staleTime: 5_000,
  });
}

export async function fetchPayoutAccountSession() {
  return (
    await apiRequest<SessionResponse>("/api/v1/payouts/account-session", {
      method: "POST",
    })
  ).data.accountSession;
}

export function usePayoutAccountSession() {
  return useMutation({ mutationFn: fetchPayoutAccountSession });
}
