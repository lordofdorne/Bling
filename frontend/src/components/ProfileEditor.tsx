import { useState, type FormEvent } from "react";
import {
  categories,
  useOwnProfile,
  useSaveProfile,
  type CreatorProfile,
  type ProfileInput,
} from "../lib/social";
import { UiIcon } from "./UiIcon";

export function ProfileEditor() {
  const profile = useOwnProfile();
  return (
    <section
      className="show-card profile-editor"
      id="profile"
      aria-label="Public profile"
    >
      <div>
        <p className="eyebrow">Your channel identity</p>
        <h2>Edit your public profile</h2>
        <p>Help people find you and get to know your corner of Bling.</p>
      </div>
      {profile.isPending ? (
        <p role="status">Loading profile…</p>
      ) : profile.isError ? (
        <div role="alert">
          <p>Unable to load your profile.</p>
          <button
            className="text-button"
            onClick={() => void profile.refetch()}
          >
            Try again
          </button>
        </div>
      ) : (
        <ProfileForm key={profile.data.id} profile={profile.data} />
      )}
    </section>
  );
}
function ProfileForm({ profile }: { profile: CreatorProfile }) {
  const [draft, setDraft] = useState<ProfileInput>({
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    coverUrl: profile.coverUrl,
    category: profile.category,
    published: profile.published,
  });
  const save = useSaveProfile();
  const [saved, setSaved] = useState(false);
  function update<K extends keyof ProfileInput>(
    key: K,
    value: ProfileInput[K],
  ) {
    setDraft((old) => ({ ...old, [key]: value }));
    setSaved(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await save.mutateAsync(draft);
      setSaved(true);
    } catch {
      /* Error state shown below. */
    }
  }
  return (
    <form className="auth-form profile-form" onSubmit={submit}>
      <label>
        Display name
        <input
          required
          maxLength={60}
          value={draft.displayName}
          onChange={(e) => update("displayName", e.target.value)}
        />
      </label>
      <label>
        Category
        <select
          value={draft.category}
          onChange={(e) => update("category", e.target.value)}
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="full-width">
        About your channel
        <textarea
          maxLength={500}
          value={draft.bio}
          onChange={(e) => update("bio", e.target.value)}
          placeholder="What do you love talking about?"
        />
      </label>
      <label>
        Avatar image URL
        <input
          type="url"
          maxLength={2048}
          pattern="https://.*"
          placeholder="https://…"
          value={draft.avatarUrl}
          onChange={(e) => update("avatarUrl", e.target.value)}
        />
        <small>Use an HTTPS image you own or have permission to use.</small>
      </label>
      <label>
        Cover image URL
        <input
          type="url"
          maxLength={2048}
          pattern="https://.*"
          placeholder="https://…"
          value={draft.coverUrl}
          onChange={(e) => update("coverUrl", e.target.value)}
        />
        <small>
          Landscape images work best. Leave blank for your channel initials.
        </small>
      </label>
      <label className="publish-profile full-width">
        <input
          type="checkbox"
          checked={draft.published}
          disabled={profile.isLive}
          onChange={(e) => update("published", e.target.checked)}
        />
        Show my profile in discovery
      </label>
      {profile.isLive && (
        <small className="full-width">
          Your profile stays published while your Hotline is live.
        </small>
      )}
      <div className="full-width profile-save">
        <button className="primary-button" disabled={save.isPending}>
          <UiIcon name="check" size={17} />
          {save.isPending ? "Saving…" : "Save profile"}
        </button>
        {saved && <span role="status">Profile saved.</span>}
      </div>
      {save.isError && (
        <p className="form-error full-width" role="alert">
          {save.error.message}
        </p>
      )}
    </form>
  );
}
