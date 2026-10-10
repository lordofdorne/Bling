import { usingConvex } from "./backend";
import * as convexHooks from "./convex/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./api";

export type PaymentAuthorization = {
  attemptId: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  currency: string;
  customerSessionClientSecret?: string;
};

export type SavedPaymentMethod = {
  id: string;
  type: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type PaymentMethodSetup = {
  clientSecret: string;
  customerSessionClientSecret: string;
  publishableKey: string;
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

function useAuthorizePaymentGo(showID: string) {
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

const paymentMethodsKey = ["me", "payment-methods"] as const;

function usePaymentMethodsGo() {
  return useQuery({
    queryKey: paymentMethodsKey,
    queryFn: async () =>
      (
        await apiRequest<{
          data: { paymentMethods: SavedPaymentMethod[] };
        }>("/api/v1/me/payment-methods")
      ).data.paymentMethods,
    staleTime: 15_000,
  });
}

function usePaymentMethodSetupGo() {
  return useMutation({
    mutationFn: async () =>
      (
        await apiRequest<{ data: { setup: PaymentMethodSetup } }>(
          "/api/v1/me/payment-methods/setup-session",
          { method: "POST" },
        )
      ).data.setup,
  });
}

function useRemovePaymentMethodGo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentMethodID: string) =>
      apiRequest<void>(
        `/api/v1/me/payment-methods/${encodeURIComponent(paymentMethodID)}`,
        { method: "DELETE" },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: paymentMethodsKey }),
  });
}

function useRefreshPaymentMethodsGo() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: paymentMethodsKey });
}

// The Convex build swaps in src/lib/convex/hooks.ts (see lib/backend.ts).
export const useAuthorizePayment = usingConvex
  ? convexHooks.useAuthorizePayment
  : useAuthorizePaymentGo;
export const usePaymentMethods = usingConvex
  ? convexHooks.usePaymentMethods
  : usePaymentMethodsGo;
export const usePaymentMethodSetup = usingConvex
  ? convexHooks.usePaymentMethodSetup
  : usePaymentMethodSetupGo;
export const useRemovePaymentMethod = usingConvex
  ? convexHooks.useRemovePaymentMethod
  : useRemovePaymentMethodGo;
export const useRefreshPaymentMethods = usingConvex
  ? convexHooks.useRefreshPaymentMethods
  : useRefreshPaymentMethodsGo;
