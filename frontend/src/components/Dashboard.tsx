import { Link, useNavigate } from "react-router-dom";
import { useLogout, useMe } from "../lib/auth";

export function Dashboard() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  async function signOut() {
    try {
      await logout.mutateAsync();
      navigate("/login", { replace: true });
    } catch {
      // The inline status below keeps the creator in a recoverable state.
    }
  }

  return (
    <main className="page dashboard-page">
      <nav className="nav">
        <Link className="brand" to="/">
          Bling<span>.</span>
        </Link>
        <button
          className="button secondary"
          type="button"
          onClick={signOut}
          disabled={logout.isPending}
        >
          {logout.isPending ? "Signing out…" : "Sign out"}
        </button>
      </nav>
      <section className="dashboard-content">
        <p className="eyebrow">Creator workspace</p>
        <h1>Welcome, {me.data?.username}.</h1>
        <p className="lede">
          Your account is ready. Show controls arrive in the next delivery
          slice.
        </p>
        <div className="account-card">
          <span>Public URL</span>
          <strong>/u/{me.data?.username}</strong>
          <span>Account email</span>
          <strong>{me.data?.email}</strong>
        </div>
        {logout.isError && (
          <div className="form-error" role="alert">
            Unable to sign out. Please try again.
          </div>
        )}
      </section>
    </main>
  );
}
