import { useState, type ChangeEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, Check, Upload, X } from "lucide-react";
import {
  useOwnProfile,
  useSaveProfile,
  useUploadAvatar,
  type CreatorProfile,
} from "../lib/social";
import { profileSchema, type ProfileValues } from "../lib/schemas";
import { MAX_TOPICS, TOPICS, type Topic } from "../lib/topics";
import {
  FormError,
  SwitchField,
  TextField,
  TextareaField,
} from "./form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useControlSize } from "../lib/design";

export function ProfileEditor() {
  const profile = useOwnProfile();
  return (
    <section
      id="profile"
      aria-label="Public profile"
      className="flex flex-col gap-(--stack-gap)"
    >
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
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      coverUrl: profile.coverUrl,
      published: profile.published,
      topics: (profile.topics ?? []).filter((topic): topic is Topic =>
        (TOPICS as readonly string[]).includes(topic),
      ),
    },
  });
  const save = useSaveProfile();
  const controlSize = useControlSize();
  const uploadAvatar = useUploadAvatar();
  const [saved, setSaved] = useState(false);
  // The chosen file is uploaded on save, so it stays outside the form values
  // until it becomes a URL.
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState(profile.avatarUrl);
  const [avatarError, setAvatarError] = useState("");
  const [avatarInputKey, setAvatarInputKey] = useState(0);
  const [displayName, avatarUrl] = useWatch({
    control: form.control,
    name: ["displayName", "avatarUrl"],
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      const nextAvatarUrl = avatarFile
        ? await uploadAvatar.mutateAsync(avatarFile)
        : values.avatarUrl;
      const next = { ...values, avatarUrl: nextAvatarUrl };
      await save.mutateAsync(next);
      form.reset(next);
      setAvatarFile(null);
      setAvatarPreview(nextAvatarUrl);
      setAvatarInputKey((key) => key + 1);
      setSaved(true);
    } catch {
      /* Error state shown below. */
    }
  });

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
        <Form {...form}>
          <form
            className="grid gap-(--card-gap) tablet:grid-cols-2"
            onSubmit={submit}
            noValidate
          >
            <TextField
              control={form.control}
              name="displayName"
              label="Display name"
              className="tablet:col-span-2"
            />

            <TextareaField
              control={form.control}
              name="bio"
              label="About your channel"
              className="tablet:col-span-2"
              rows={4}
              placeholder="What do you love talking about?"
            />

            <FormField
              control={form.control}
              name="topics"
              render={({ field }) => (
                <FormItem className="tablet:col-span-2">
                  <FormLabel>What you talk about</FormLabel>
                  <FormControl>
                    <div
                      role="group"
                      aria-label="What you talk about"
                      className="flex flex-wrap gap-2"
                    >
                      {TOPICS.map((topic) => {
                        const selected = field.value.includes(topic);
                        const full =
                          !selected && field.value.length >= MAX_TOPICS;
                        return (
                          <Button
                            key={topic}
                            type="button"
                            size="sm"
                            variant={selected ? "default" : "outline"}
                            className="rounded-full"
                            aria-pressed={selected}
                            disabled={full}
                            onClick={() => {
                              field.onChange(
                                selected
                                  ? field.value.filter((t) => t !== topic)
                                  : [...field.value, topic],
                              );
                              setSaved(false);
                            }}
                          >
                            {selected && <Check className="size-3.5" />}
                            {topic}
                          </Button>
                        );
                      })}
                    </div>
                  </FormControl>
                  <FormDescription>
                    Pick up to {MAX_TOPICS}. Fans browsing a topic on the home
                    page will find you.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                    {displayName.slice(0, 2).toUpperCase()}
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
                    <Button
                      asChild
                      variant="outline"
                      className="cursor-pointer"
                    >
                      <label htmlFor="profile-avatar">
                        <Camera className="size-4" />
                        {avatarUrl || avatarFile
                          ? "Change photo"
                          : "Choose photo"}
                      </label>
                    </Button>
                    {(avatarUrl || avatarFile) && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setAvatarFile(null);
                          setAvatarPreview("");
                          setAvatarInputKey((key) => key + 1);
                          form.setValue("avatarUrl", "", { shouldDirty: true });
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

            <TextField
              control={form.control}
              name="coverUrl"
              label="Cover image URL"
              type="url"
              inputMode="url"
              placeholder="https://…"
              description="Landscape images work best. Leave blank for your channel initials."
            />

            <SwitchField
              control={form.control}
              name="published"
              label="Show my profile in discovery"
              className="tablet:col-span-2"
              disabled={profile.isLive}
              description={
                profile.isLive
                  ? "Your profile stays published while your Hotline is live."
                  : undefined
              }
            />

            <div className="flex flex-wrap items-center gap-3 tablet:col-span-2">
              <Button
                type="submit"
                size={controlSize}
                className="w-full tablet:w-auto"
                disabled={save.isPending || uploadAvatar.isPending}
              >
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
              {saved && !form.formState.isDirty && (
                <span role="status" className="text-muted-foreground text-sm">
                  Profile saved.
                </span>
              )}
            </div>

            <FormError
              error={save.error ?? uploadAvatar.error}
              fallback="Unable to save your profile. Please try again."
              className="tablet:col-span-2"
            />
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
