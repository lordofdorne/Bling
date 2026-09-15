import { Link, useLocation } from "react-router-dom";
import { Check, Plus } from "lucide-react";
import { useMe } from "../lib/auth";
import {
  useFollowBusy,
  useFollowCreator,
  type CreatorProfile,
} from "../lib/social";
import { Button } from "@/components/ui/button";

export function FollowButton({
  profile,
  compact = false,
}: {
  profile: CreatorProfile;
  compact?: boolean;
}) {
  const me = useMe();
  const follow = useFollowCreator();
  const busy = useFollowBusy();
  const location = useLocation();
  if (me.data?.id === profile.id) return null;

  const variant = profile.isFollowing ? "secondary" : "outline";
  const size = compact ? "icon" : "default";

  if (!me.isPending && !me.data)
    return (
      <Button
        asChild
        variant={variant}
        size={size}
        className="rounded-full"
        aria-label={`Sign in to follow ${profile.displayName}`}
      >
        <Link
          to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        >
          <Plus className="size-4" />
          {!compact && <span>Follow</span>}
        </Link>
      </Button>
    );

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        className="rounded-full"
        aria-pressed={profile.isFollowing}
        aria-label={`${profile.isFollowing ? "Unfollow" : "Follow"} ${profile.displayName}`}
        disabled={me.isPending || busy}
        onClick={() =>
          follow.mutate({ profile, following: !profile.isFollowing })
        }
      >
        {profile.isFollowing ? (
          <Check className="size-4" />
        ) : (
          <Plus className="size-4" />
        )}
        {!compact && (
          <span>
            {follow.isPending
              ? "Saving…"
              : profile.isFollowing
                ? "Following"
                : "Follow"}
          </span>
        )}
      </Button>
      {follow.isError && (
        <span className="text-destructive text-xs" role="alert">
          {follow.error.message}
        </span>
      )}
    </span>
  );
}
