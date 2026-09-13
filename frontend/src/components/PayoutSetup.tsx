import { useMemo } from "react";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";
import {
  fetchPayoutAccountSession,
  PayoutAccountSession,
} from "../lib/payouts";

export function PayoutSetup({
  session,
  onExit,
}: {
  session: PayoutAccountSession;
  onExit: () => void;
}) {
  const instance = useMemo(
    () =>
      loadConnectAndInitialize({
        publishableKey: session.publishableKey,
        fetchClientSecret: async () =>
          (await fetchPayoutAccountSession()).clientSecret,
        appearance: {
          variables: {
            colorPrimary: "#5B8C5A",
            colorBackground: "#ffffff",
            colorText: "#52414C",
            colorDanger: "#E3655B",
            borderRadius: "14px",
            spacingUnit: "12px",
            fontFamily: "Inter, ui-sans-serif, system-ui",
          },
        },
      }),
    [session.publishableKey],
  );
  return (
    <div className="payout-setup-embed">
      <ConnectComponentsProvider connectInstance={instance}>
        <ConnectAccountOnboarding onExit={onExit} />
      </ConnectComponentsProvider>
    </div>
  );
}
