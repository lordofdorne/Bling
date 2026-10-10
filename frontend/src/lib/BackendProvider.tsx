import { ConvexAuthProvider } from "@convex-dev/auth/react";
import type { ReactNode } from "react";
import { convex } from "./backend";

/** Convex Auth around the app when the Convex backend is selected. */
export function BackendProvider({ children }: { children: ReactNode }) {
  return convex ? (
    <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>
  ) : (
    children
  );
}
