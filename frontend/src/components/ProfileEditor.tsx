import { useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import {
  categories,
  useOwnProfile,
  useSaveProfile,
  type CreatorProfile,
  type ProfileInput,
} from "../lib/social";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function ProfileEditor() {
  const profile = useOwnProfile();
  return (
    <section
      id="profile"
      aria-label="Public profile"
      className="flex flex-col gap-6"
    >
      <header>
        <h2 className="text-xl font-bold tracking-tight">
          Edit your public profile
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Help people find you and get to know your corner of Bling.
        </p>
      </header>
      {profile.isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          Loading profile…
        </p>
      ) : profile.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Unable to load your profile.
            <Button
              variant="link"
              className="h-auto px-2"
              onClick={() => void profile.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
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
    <Card>
      <CardContent>
        <form className="grid gap-5 md:grid-cols-2" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="profile-name">Display name</Label>
            <Input
              id="profile-name"
              required
              maxLength={60}
              value={draft.displayName}
              onChange={(e) => update("displayName", e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="profile-category">Category</Label>
            <Select
              value={draft.category}
              onValueChange={(value) => update("category", value)}
            >
              <SelectTrigger id="profile-category" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="profile-bio">About your channel</Label>
            <Textarea
              id="profile-bio"
              maxLength={500}
              rows={4}
              value={draft.bio}
              onChange={(e) => update("bio", e.target.value)}
              placeholder="What do you love talking about?"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="profile-avatar">Avatar image URL</Label>
            <Input
              id="profile-avatar"
              type="url"
              maxLength={2048}
              pattern="https://.*"
              placeholder="https://…"
              value={draft.avatarUrl}
              onChange={(e) => update("avatarUrl", e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Use an HTTPS image you own or have permission to use.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="profile-cover">Cover image URL</Label>
            <Input
              id="profile-cover"
              type="url"
              maxLength={2048}
              pattern="https://.*"
              placeholder="https://…"
              value={draft.coverUrl}
              onChange={(e) => update("coverUrl", e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Landscape images work best. Leave blank for your channel initials.
            </p>
          </div>

          <div className="md:col-span-2">
            <Label className="gap-3" htmlFor="profile-published">
              <Switch
                id="profile-published"
                checked={draft.published}
                disabled={profile.isLive}
                onCheckedChange={(checked) => update("published", checked)}
              />
              Show my profile in discovery
            </Label>
            {profile.isLive && (
              <p className="text-muted-foreground mt-2 text-xs">
                Your profile stays published while your Hotline is live.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <Button disabled={save.isPending}>
              <Check className="size-4" />
              {save.isPending ? "Saving…" : "Save profile"}
            </Button>
            {saved && (
              <span role="status" className="text-muted-foreground text-sm">
                Profile saved.
              </span>
            )}
          </div>

          {save.isError && (
            <Alert variant="destructive" className="md:col-span-2">
              <AlertDescription>{save.error.message}</AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
