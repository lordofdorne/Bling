import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useMe } from "../lib/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="text-muted-foreground text-sm">
          Loading your workspace…
        </div>
      </main>
    );
  }
  if (me.isError) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>
            Unable to load your account. Try refreshing.
          </AlertDescription>
        </Alert>
      </main>
    );
  }
  if (!me.data) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
