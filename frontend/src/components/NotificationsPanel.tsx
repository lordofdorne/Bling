import { Link } from "react-router-dom";
import { useMe } from "../lib/auth";
import { useMarkNotificationsRead, useNotifications } from "../lib/social";
import { CreatorAvatar } from "./CreatorIdentity";

export function NotificationsPanel({ close }: { close: () => void }) {
  const me = useMe();
  const notifications = useNotifications();
  const read = useMarkNotificationsRead();
  const items = [
    ...new Map(
      (notifications.data?.pages ?? [])
        .flatMap((p) => p.items)
        .map((n) => [n.id, n]),
    ).values(),
  ];
  if (!me.data)
    return (
      <p>
        <Link className="text-link" to="/login?next=%2Ffollowing">
          Sign in
        </Link>{" "}
        to see live updates from creators you follow.
      </p>
    );
  if (notifications.isPending)
    return <p role="status">Loading your updates…</p>;
  if (notifications.isError && !notifications.data)
    return (
      <div role="alert">
        <p>Unable to load notifications.</p>
        <button
          className="text-button"
          onClick={() => void notifications.refetch()}
        >
          Try again
        </button>
      </div>
    );
  return (
    <>
      <p className="muted">Live updates · last 30 days</p>
      {items.length === 0 ? (
        <p>No updates yet. Follow creators to hear when they go live.</p>
      ) : (
        <>
          <button
            className="text-button"
            disabled={read.isPending || items.every((n) => n.read)}
            onClick={() =>
              read.mutate(
                items
                  .filter((n) => !n.read)
                  .slice(0, 50)
                  .map((n) => n.id),
              )
            }
          >
            Mark shown updates as read
          </button>
          <div className="notification-list">
            {items.map((n) => (
              <div className="notification-entry" key={n.id}>
                <Link
                  className="notification-item"
                  to={`/u/${n.username}`}
                  onClick={() => {
                    if (!n.read) read.mutate([n.id]);
                    close();
                  }}
                >
                  <CreatorAvatar profile={n} />
                  <span>
                    <strong>{n.displayName} went live</strong>
                    <small>
                      {new Date(n.createdAt).toLocaleString()} ·{" "}
                      {n.isLive ? "Live now" : "Hotline ended"}
                    </small>
                  </span>
                  {!n.read && <span className="live-dot" aria-label="Unread" />}
                </Link>
                {!n.read && (
                  <button
                    className="text-button"
                    disabled={read.isPending}
                    onClick={() => read.mutate([n.id])}
                    aria-label={`Mark ${n.displayName}'s update as read`}
                  >
                    Mark read
                  </button>
                )}
              </div>
            ))}
          </div>
          {notifications.hasNextPage && (
            <button
              className="text-button"
              disabled={notifications.isFetchingNextPage}
              onClick={() => void notifications.fetchNextPage()}
            >
              Load more updates
            </button>
          )}
        </>
      )}
      {notifications.isFetchNextPageError && (
        <p role="alert">Could not load more updates. Try again.</p>
      )}
      {read.isError && (
        <p className="form-error" role="alert">
          Could not mark updates read. Please try again.
        </p>
      )}
    </>
  );
}
