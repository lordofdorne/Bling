import { useEffect, useMemo } from "react";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";
import {
  fetchPayoutAccountSession,
  PayoutAccountSession,
} from "../lib/payouts";
import {
  stripeConnectAppearance,
  useStripeAppearance,
} from "../lib/stripe-appearance";

export function PayoutSetup({
  session,
  onExit,
}: {
  session: PayoutAccountSession;
  onExit: () => void;
}) {
  const appearance = useStripeAppearance().connect;
  // The instance is created once per key with the current tokens; later theme
  // changes go through update() so the onboarding flow keeps its progress.
  const instance = useMemo(
    () =>
      loadConnectAndInitialize({
        publishableKey: session.publishableKey,
        fetchClientSecret: async () =>
          (await fetchPayoutAccountSession()).clientSecret,
        appearance: stripeConnectAppearance(),
      }),
    [session.publishableKey],
  );
  useEffect(() => {
    instance.update({ appearance });
  }, [instance, appearance]);

  return (
    <div className="[&_iframe]:w-full">
      <ConnectComponentsProvider connectInstance={instance}>
        <ConnectAccountOnboarding onExit={onExit} />
      </ConnectComponentsProvider>
    </div>
  );
}
