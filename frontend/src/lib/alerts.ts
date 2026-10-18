import { usingConvex } from "./backend";
import * as convexHooks from "./convex/hooks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError } from "./api";

/** The signed-in user's email choices; null when there's no email to send to. */
export type EmailPreferences = { email: string; liveAlerts: boolean } | null;

// The Go API sends no live alerts, so its build has no preferences to show.
function useEmailPreferencesGo() {
  return useQuery({
    queryKey: ["me", "email-preferences"],
    queryFn: async (): Promise<EmailPreferences> => null,
  });
}

function useSetLiveAlertsGo() {
  return useMutation({
    mutationFn: async (_enabled: boolean) => {
      throw new ApiError(
        501,
        "NOT_SUPPORTED",
        "Email alerts aren't available on this server.",
      );
    },
  });
}

// The Convex build swaps in src/lib/convex/hooks.ts (see lib/backend.ts).
export const useEmailPreferences = usingConvex
  ? convexHooks.useEmailPreferences
  : useEmailPreferencesGo;
export const useSetLiveAlerts = usingConvex
  ? convexHooks.useSetLiveAlerts
  : useSetLiveAlertsGo;
