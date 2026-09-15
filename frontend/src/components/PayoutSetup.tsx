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
import { cssToken } from "../lib/theme";

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
            colorPrimary: cssToken("--green"),
            colorBackground: cssToken("--stripe-embed-bg"),
            colorText: cssToken("--mauve"),
            colorDanger: cssToken("--accent"),
            borderRadius: "14px",
            spacingUnit: "12px",
            fontFamily: "Inter, ui-sans-serif, system-ui",
          },
        },
      }),
    [session.publishableKey],
  );
  return (
    <div className="[&_iframe]:w-full rounded-xl bg-[var(--stripe-embed-bg)] p-4">
      <ConnectComponentsProvider connectInstance={instance}>
        <ConnectAccountOnboarding onExit={onExit} />
      </ConnectComponentsProvider>
    </div>
  );
}
