import { Link, useNavigate } from "react-router-dom";
import { useLogout, useMe } from "../lib/auth";
import { useCreatorQueue, useQueueEvents } from "../lib/queue";
import { useEndShow, useLiveShow, useStartShow } from "../lib/shows";

function CallerList({ showID }: { showID: string }) {
  const queue = useCreatorQueue(showID);
  useQueueEvents(showID, "creator", true);
  if (queue.isPending)
    return <div className="status">Loading caller queue…</div>;
  if (queue.isError)
    return (
      <div className="form-error" role="alert">
        Unable to load the caller queue.
      </div>
    );
  const entries = queue.data ?? [];
  return (
    <section className="caller-list" aria-label="Caller queue">
      <div className="caller-list-heading">
        <h2>Caller queue</h2>
        <span>{entries.length} waiting</span>
      </div>
      {entries.length === 0 ? (
        <p className="empty-queue">
          Share your public URL. Callers will appear here.
        </p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{entry.displayName}</strong>
                <span>
                  {entry.tierName} · {entry.callDurationSeconds}s
                </span>
              </div>
              <p>{entry.topic}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function Dashboard() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const username = me.data?.username ?? "";
  const liveShow = useLiveShow(username);
  const startShow = useStartShow(username);
  const endShow = useEndShow(username);
  const activeShow = liveShow.data;

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
        <h1>Welcome, {username}.</h1>
        <p className="lede">
          Open your Hotline when you are ready to take live calls from your
          audience.
        </p>

        <section className="show-card" aria-label="Hotline controls">
          {liveShow.isPending ? (
            <div className="status">Loading show status…</div>
          ) : liveShow.isError ? (
            <div className="form-error" role="alert">
              Unable to load your Hotline status.
            </div>
          ) : activeShow ? (
            <>
              <div className="show-card-heading">
                <div>
                  <div className="live-badge">
                    <span /> Hotline live
                  </div>
                  <h2>Your audience can join.</h2>
                </div>
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => endShow.mutate(activeShow.id)}
                  disabled={endShow.isPending}
                >
                  {endShow.isPending ? "Ending…" : "End Hotline"}
                </button>
              </div>
              <p>
                Public URL: <strong>/u/{username}</strong>
              </p>
              <CallerList showID={activeShow.id} />
            </>
          ) : (
            <>
              <h2>No active Hotline</h2>
              <p>
                Start a show to open your public page. No microphone is
                requested until you select a caller.
              </p>
              <button
                className="primary-button"
                type="button"
                onClick={() => startShow.mutate()}
                disabled={startShow.isPending}
              >
                {startShow.isPending ? "Starting…" : "Start Hotline"}
              </button>
            </>
          )}
          {(startShow.isError || endShow.isError) && (
            <div className="form-error" role="alert">
              Unable to update your Hotline. Please try again.
            </div>
          )}
        </section>

        <div className="account-card">
          <span>Public URL</span>
          <strong>/u/{username}</strong>
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
