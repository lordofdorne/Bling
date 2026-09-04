import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "./api";

export type PaymentAuthorization = {
  attemptId: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  currency: string;
};

type AuthorizationResponse = { data: PaymentAuthorization };

function paymentKey(showID: string, tierID: string) {
  const storageKey = `bling:payment:${showID}:${tierID}:key`;
  let value = sessionStorage.getItem(storageKey);
  if (!value) {
    value = crypto.randomUUID();
    sessionStorage.setItem(storageKey, value);
  }
  return { storageKey, value };
}

export function useAuthorizePayment(showID: string) {
  return useMutation({
    mutationFn: async (tierID: string) => {
      const key = paymentKey(showID, tierID);
      const response = await apiRequest<AuthorizationResponse>(
        `/api/v1/shows/${showID}/payments/authorize`,
        {
          method: "POST",
          headers: { "Idempotency-Key": key.value },
          body: JSON.stringify({ tierId: tierID }),
        },
      );
      return { ...response.data, storageKey: key.storageKey };
    },
  });
}
