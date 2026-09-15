import { useState } from "react";
import type { CreatorProfile } from "../lib/social";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function CreatorAvatar({
  profile,
  className,
}: {
  profile: Pick<CreatorProfile, "displayName" | "avatarUrl">;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-9", className)}>
      {profile.avatarUrl && (
        <AvatarImage
          src={profile.avatarUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      <AvatarFallback className="bg-[var(--mauve-surface)] text-[var(--mauve-muted)]">
        {profile.displayName.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
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
      className="absolute inset-0 size-full object-cover"
      onError={() => setFailed(profile.coverUrl)}
    />
  ) : (
    <div
      className="absolute inset-0 grid place-items-center bg-[var(--mauve-surface)]"
      aria-hidden="true"
    >
      <span className="text-[var(--sand)] text-6xl font-semibold opacity-70">
        {profile.displayName.slice(0, 1).toUpperCase()}
      </span>
    </div>
  );
}
