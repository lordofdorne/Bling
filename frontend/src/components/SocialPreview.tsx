import { useState, type ReactNode } from "react";
import { UiIcon } from "./UiIcon";
import { FollowContext, usePreviewFollows } from "../ui/preview-follows";

const storageKey = "bling:design-preview:follows";

export function SocialPreviewProvider({ children }: { children: ReactNode }) {
  const [following, setFollowing] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(storageKey) ?? "[]",
      );
      return Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  });
  function toggle(id: string) {
    setFollowing((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Keep the preview usable when storage is unavailable. */
      }
      return next;
    });
  }
  return (
    <FollowContext.Provider value={{ following, toggle }}>
      {children}
    </FollowContext.Provider>
  );
}
export function FollowButton({
  username,
  compact = false,
}: {
  username: string;
  compact?: boolean;
}) {
  const { following, toggle } = usePreviewFollows();
  const followed = following.includes(username);
  return (
    <button
      type="button"
      className={`follow-button ${followed ? "is-following" : ""} ${compact ? "compact" : ""}`}
      onClick={() => toggle(username)}
      aria-pressed={followed}
      aria-label={`${followed ? "Unfollow" : "Follow"} ${username}`}
      title="Preview: saved on this device only"
    >
      <UiIcon name={followed ? "check" : "plus"} size={16} />
      <span>{followed ? "Following" : "Follow"}</span>
    </button>
  );
}
