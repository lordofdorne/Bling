import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useCallback } from "react";
import { api } from "../../../convex/_generated/api";
import { convexClient } from "../backend";

// Callers need a Convex identity to join a queue, pay or be counted on a
// channel, but not an account. The first time one is needed the browser
// signs in anonymously; the session then survives reloads, as the Go API's
// viewer cookie did, and signing in later replaces it.
//
// One sign-in is shared by everything that asks at once (a page can join,
// pay and send a channel heartbeat together), and it only counts as done
// once the server sees the session: signIn resolves before the client's new
// token reaches the server, and calls made in that gap fail.

let pending: Promise<void> | null = null;

async function waitForServerSession() {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await convexClient().query(api.users.hasSession, {})) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Could not start a session. Check your connection.");
}

export function useEnsureSession() {
  const { isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  return useCallback(async () => {
    if (isAuthenticated) return;
    pending ??= (async () => {
      try {
        // React's auth state can lag a sign-in that just finished; asking
        // the server first avoids a second anonymous account.
        if (await convexClient().query(api.users.hasSession, {})) return;
        await signIn("anonymous");
        await waitForServerSession();
      } finally {
        pending = null;
      }
    })();
    await pending;
  }, [isAuthenticated, signIn]);
}
