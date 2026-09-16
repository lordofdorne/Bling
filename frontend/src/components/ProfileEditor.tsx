import { useState, type ChangeEvent, type FormEvent } from "react";
import { Camera, Check, Upload, X } from "lucide-react";
import {
  categories,
  useOwnProfile,
  useSaveProfile,
  useUploadAvatar,
  type CreatorProfile,
  type ProfileInput,
} from "../lib/social";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  const uploadAvatar = useUploadAvatar();
  const [saved, setSaved] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState(profile.avatarUrl);
  const [avatarError, setAvatarError] = useState("");
  const [avatarInputKey, setAvatarInputKey] = useState(0);

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
      const avatarUrl = avatarFile
        ? await uploadAvatar.mutateAsync(avatarFile)
        : draft.avatarUrl;
      await save.mutateAsync({ ...draft, avatarUrl });
      setDraft((old) => ({ ...old, avatarUrl }));
      setAvatarFile(null);
      setAvatarPreview(avatarUrl);
      setAvatarInputKey((key) => key + 1);
      setSaved(true);
    } catch {
      /* Error state shown below. */
    }
  }

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setAvatarError("");
    if (!file) {
      setAvatarFile(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAvatarError("Choose a JPG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }
    if (file.size > 768 * 1024) {
      setAvatarError("Choose an image smaller than 768 KB.");
      event.target.value = "";
      return;
    }
    setAvatarFile(file);
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") setAvatarPreview(reader.result);
    });
    reader.readAsDataURL(file);
    setSaved(false);
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

          <div className="grid gap-3">
            <Label htmlFor="profile-avatar">Profile picture</Label>
            <div className="flex items-center gap-4">
              <Avatar className="border-border bg-muted size-(--profile-avatar-size) border">
                {avatarPreview && (
                  <AvatarImage
                    src={avatarPreview}
                    alt="Profile picture preview"
                  />
                )}
                <AvatarFallback>
                  {draft.displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <Input
                key={avatarInputKey}
                id="profile-avatar"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={chooseAvatar}
              />
              <div className="flex flex-col items-start gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" className="cursor-pointer">
                    <label htmlFor="profile-avatar">
                      <Camera className="size-4" />
                      {draft.avatarUrl || avatarFile
                        ? "Change photo"
                        : "Choose photo"}
                    </label>
                  </Button>
                  {(draft.avatarUrl || avatarFile) && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setAvatarFile(null);
                        setAvatarPreview("");
                        setAvatarInputKey((key) => key + 1);
                        update("avatarUrl", "");
                      }}
                    >
                      <X className="size-4" />
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {avatarFile?.name ?? "JPG, PNG, or WebP · 768 KB max"}
                </p>
              </div>
            </div>
            {avatarError && (
              <p role="alert" className="text-destructive text-xs">
                {avatarError}
              </p>
            )}
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
            <Button disabled={save.isPending || uploadAvatar.isPending}>
              {uploadAvatar.isPending ? (
                <Upload className="size-4" />
              ) : (
                <Check className="size-4" />
              )}
              {uploadAvatar.isPending
                ? "Uploading…"
                : save.isPending
                  ? "Saving…"
                  : "Save profile"}
            </Button>
            {saved && (
              <span role="status" className="text-muted-foreground text-sm">
                Profile saved.
              </span>
            )}
          </div>

          {(save.isError || uploadAvatar.isError) && (
            <Alert variant="destructive" className="md:col-span-2">
              <AlertDescription>
                {(save.error ?? uploadAvatar.error)?.message}
              </AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
