import { useState } from "react";
import type { CreatorProfile } from "../lib/social";

export function CreatorAvatar({
  profile,
}: {
  profile: Pick<CreatorProfile, "displayName" | "avatarUrl">;
}) {
  const [failed, setFailed] = useState("");
  return (
    <span className="avatar-image">
      {profile.avatarUrl && failed !== profile.avatarUrl ? (
        <img
          src={profile.avatarUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(profile.avatarUrl)}
        />
      ) : (
        <span className="avatar-initials">
          {profile.displayName.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  );
}
export function CreatorCover({ profile }: { profile: CreatorProfile }) {
  const [failed, setFailed] = useState("");
  return profile.coverUrl && failed !== profile.coverUrl ? (
    <img
      src={profile.coverUrl}
      alt={`${profile.displayName}'s channel`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(profile.coverUrl)}
    />
  ) : (
    <div className="creator-cover-fallback" aria-hidden="true">
      <span>{profile.displayName.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}
