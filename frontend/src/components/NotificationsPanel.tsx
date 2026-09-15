import { Link } from "react-router-dom";
import { useMe } from "../lib/auth";
import { useMarkNotificationsRead, useNotifications } from "../lib/social";
import { CreatorAvatar } from "./CreatorIdentity";
import { Button } from "@/components/ui/button";

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
      <p className="text-muted-foreground text-sm">
        <Link
          className="text-foreground font-semibold underline"
          to="/login?next=%2Ffollowing"
        >
          Sign in
        </Link>{" "}
        to see live updates from creators you follow.
      </p>
    );
  if (notifications.isPending)
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Loading your updates…
      </p>
    );
  if (notifications.isError && !notifications.data)
    return (
      <div role="alert" className="text-sm">
        <p>Unable to load notifications.</p>
        <Button
          variant="link"
          className="h-auto px-0"
          onClick={() => void notifications.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  return (
    <>
      <p className="text-muted-foreground text-xs">
        Live updates · last 30 days
      </p>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No updates yet. Follow creators to hear when they go live.
        </p>
      ) : (
        <>
          <Button
            variant="link"
            className="h-auto justify-start px-0 text-xs"
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
          </Button>
          <div className="flex flex-col gap-1">
            {items.map((n) => (
              <div key={n.id} className="flex flex-col">
                <Link
                  className="hover:bg-accent flex items-center gap-3 rounded-lg p-2 transition-colors"
                  to={`/u/${n.username}`}
                  onClick={() => {
                    if (!n.read) read.mutate([n.id]);
                    close();
                  }}
                >
                  <CreatorAvatar profile={n} className="size-8" />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-semibold">
                      {n.displayName} went live
                    </strong>
                    <small className="text-muted-foreground block truncate text-xs">
                      {new Date(n.createdAt).toLocaleString()} ·{" "}
                      {n.isLive ? "Live now" : "Hotline ended"}
                    </small>
                  </span>
                  {!n.read && (
                    <span
                      className="bg-primary size-2 shrink-0 rounded-full"
                      aria-label="Unread"
                    />
                  )}
                </Link>
                {!n.read && (
                  <Button
                    variant="link"
                    className="h-auto justify-start px-2 pb-2 text-xs"
                    disabled={read.isPending}
                    onClick={() => read.mutate([n.id])}
                    aria-label={`Mark ${n.displayName}'s update as read`}
                  >
                    Mark read
                  </Button>
                )}
              </div>
            ))}
          </div>
          {notifications.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              disabled={notifications.isFetchingNextPage}
              onClick={() => void notifications.fetchNextPage()}
            >
              Load more updates
            </Button>
          )}
        </>
      )}
      {notifications.isFetchNextPageError && (
        <p role="alert" className="text-destructive text-sm">
          Could not load more updates. Try again.
        </p>
      )}
      {read.isError && (
        <p className="text-destructive text-sm" role="alert">
          Could not mark updates read. Please try again.
        </p>
      )}
    </>
  );
}
