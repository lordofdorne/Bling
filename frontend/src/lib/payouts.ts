import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./api";

export type PayoutStatus = {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  ready: boolean;
  requirementsDue: string[];
  platformFeePercent: number;
};

type StatusResponse = { data: { payouts: PayoutStatus } };
type LinkResponse = { data: { url: string } };

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

export function usePayoutOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (
        await apiRequest<LinkResponse>("/api/v1/payouts/onboarding-link", {
          method: "POST",
        })
      ).data.url,
    onSuccess: (url) => {
      if (url) {
        window.location.assign(url);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: payoutKey });
    },
  });
}
