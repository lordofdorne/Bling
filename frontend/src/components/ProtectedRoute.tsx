import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useMe } from "../lib/auth";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) {
    return (
      <main className="page centered">
        <div className="status">Loading your workspace…</div>
      </main>
    );
  }
  if (me.isError) {
    return (
      <main className="page centered">
        <div className="form-error" role="alert">
          Unable to load your account. Try refreshing.
        </div>
      </main>
    );
  }
  if (!me.data) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
