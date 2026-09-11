import { Link, useLocation } from "react-router-dom";
import { useMe } from "../lib/auth";
import {
  useFollowBusy,
  useFollowCreator,
  type CreatorProfile,
} from "../lib/social";
import { UiIcon } from "./UiIcon";

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
  const className = `follow-button ${profile.isFollowing ? "is-following" : ""} ${compact ? "compact" : ""}`;
  if (!me.isPending && !me.data)
    return (
      <Link
        className={className}
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        aria-label={`Sign in to follow ${profile.displayName}`}
      >
        <UiIcon name="plus" size={16} />
        <span>Follow</span>
      </Link>
    );
  return (
    <span className="follow-control">
      <button
        type="button"
        className={className}
        aria-pressed={profile.isFollowing}
        aria-label={`${profile.isFollowing ? "Unfollow" : "Follow"} ${profile.displayName}`}
        disabled={me.isPending || busy}
        onClick={() =>
          follow.mutate({ profile, following: !profile.isFollowing })
        }
      >
        <UiIcon name={profile.isFollowing ? "check" : "plus"} size={16} />
        <span>
          {follow.isPending
            ? "Saving…"
            : profile.isFollowing
              ? "Following"
              : "Follow"}
        </span>
      </button>
      {follow.isError && (
        <span className="follow-error" role="alert">
          {follow.error.message}
        </span>
      )}
    </span>
  );
}
