import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api";

export type PaymentActivity = {
  paymentAttemptId: string;
  amountCents: number;
  platformFeeCents: number;
  currency: string;
  paymentStatus: string;
  refundStatus?: string;
  refundReason?: string;
  disputeStatus?: string;
  disputeReason?: string;
  createdAt: string;
};

export type PayoutFailure = {
  payoutId: string;
  amountCents: number;
  currency: string;
  failureCode: string;
  failureMessage: string;
  updatedAt: string;
};

type ActivityResponse = {
  data: {
    activity: PaymentActivity[];
    payoutFailure: PayoutFailure | null;
  };
};

export function usePaymentActivity() {
  return useQuery({
    queryKey: ["payments", "activity"],
    queryFn: async () =>
      (await apiRequest<ActivityResponse>("/api/v1/payments/activity")).data,
    staleTime: 10_000,
  });
}
