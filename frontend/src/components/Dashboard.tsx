import { useLocation } from "react-router-dom";
import { Phone, Plus } from "lucide-react";
import { ApiError } from "../lib/api";
import { useMe } from "../lib/auth";
import { useControlSize } from "../lib/design";
import {
  useCreateShow,
  useCurrentShow,
  useEndShow,
  useStartShow,
} from "../lib/shows";
import { ProfileEditor } from "./ProfileEditor";
import { CallerList } from "./studio/CallerList";
import { GoLiveSetup } from "./studio/GoLiveSetup";
import { TierConfiguration } from "./studio/TierConfiguration";
import { PayoutSettings } from "./studio/PayoutSettings";
import { PaymentSettings } from "./studio/PaymentSettings";
import { AccountSettings } from "./studio/AccountSettings";
import { StudioShell } from "./studio/StudioShell";
import { SettingsDirectory } from "./studio/SettingsDirectory";
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "./studio/settings-sections";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PageHeader, SectionHeader } from "./page";

function StudioOverview({ username }: { username: string }) {
  const currentShow = useCurrentShow();
  const createShow = useCreateShow();
  const startShow = useStartShow(username);
  const endShow = useEndShow(username);
  const controlSize = useControlSize();
  const activeShow = currentShow.data;

  return (
    <>
      <PageHeader
        title={
          activeShow?.status === "LIVE"
            ? "You’re live."
            : `Welcome, ${username}.`
        }
      >
        <p
          className="text-muted-foreground flex items-center gap-2 text-(length:--text-body)"
          aria-label="Channel status"
        >
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              activeShow?.status === "LIVE"
                ? "bg-primary ring-primary/20 ring-4"
                : "bg-muted-foreground",
            )}
          />
          <strong className="text-foreground font-semibold">
            {currentShow.isPending
              ? "Checking status"
              : currentShow.isError
                ? "Status unavailable"
                : activeShow?.status === "LIVE"
                  ? "Hotline live"
                  : activeShow?.status === "CREATED"
                    ? "Draft ready"
                    : "Hotline offline"}
          </strong>
          ·{" "}
          {activeShow?.status === "LIVE"
            ? "Your public line is open"
            : "Your public line is closed"}
        </p>
      </PageHeader>

      <section
        id="hotline-controls"
        aria-label="Hotline controls"
        className="flex flex-col gap-(--stack-gap)"
      >
        {currentShow.isPending ? (
          <p className="text-muted-foreground text-sm">Loading show status…</p>
        ) : currentShow.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              Unable to load your Hotline status.
            </AlertDescription>
          </Alert>
        ) : activeShow?.status === "LIVE" ? (
          <Card>
            <CardContent className="flex flex-col gap-(--stack-gap)">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Badge className="gap-1.5">
                    <span className="bg-primary-foreground size-1.5 animate-pulse rounded-full" />
                    Hotline live
                  </Badge>
                  <SectionHeader
                    className="mt-2"
                    title="Your audience can join."
                  />
                </div>
                <Button
                  variant="destructive"
                  size={controlSize}
                  type="button"
                  className="w-full tablet:w-auto"
                  onClick={() => endShow.mutate(activeShow.id)}
                  disabled={endShow.isPending}
                >
                  {endShow.isPending ? "Ending…" : "End Hotline"}
                </Button>
              </div>
              <p className="text-muted-foreground text-sm">
                Public URL:{" "}
                <strong className="text-foreground">/u/{username}</strong>
              </p>
              <CallerList showID={activeShow.id} />
            </CardContent>
          </Card>
        ) : activeShow?.status === "CREATED" ? (
          <>
            <GoLiveSetup show={activeShow} />
            <TierConfiguration
              showID={activeShow.id}
              starting={startShow.isPending}
              onStart={() => startShow.mutate(activeShow.id)}
            />
          </>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-(--space-6) text-center">
              <span className="border-border-strong bg-background grid size-14 place-items-center rounded-2xl border text-[var(--sand-text)]">
                <Phone className="size-7" />
              </span>
              <Badge variant="secondary">Off air</Badge>
              <SectionHeader title="No active Hotline" />
              <p className="text-muted-foreground max-w-sm text-sm">
                Create a draft to configure caller priority, duration, and
                pricing before opening your public page.
              </p>
              <Button
                type="button"
                size={controlSize}
                className="w-full tablet:w-auto"
                onClick={() => createShow.mutate()}
                disabled={createShow.isPending}
              >
                <Plus className="size-4" />
                {createShow.isPending ? "Creating…" : "Set up Hotline"}
              </Button>
            </CardContent>
          </Card>
        )}

        {(createShow.isError || startShow.isError || endShow.isError) && (
          <Alert variant="destructive">
            <AlertDescription>
              {startShow.error instanceof ApiError &&
              startShow.error.code === "PAYOUT_SETUP_REQUIRED"
                ? startShow.error.message
                : "Unable to update your Hotline. Please try again."}
            </AlertDescription>
          </Alert>
        )}
      </section>
    </>
  );
}

function CreatorSettings({
  section,
  username,
}: {
  section: SettingsSection | null;
  username: string;
}) {
  if (!section) return <SettingsDirectory />;
  const active = SETTINGS_SECTIONS.find((item) => item.id === section);

  return (
    <div className="flex flex-col gap-(--section-gap)">
      <PageHeader
        back={{ to: "/dashboard/settings", label: "Settings" }}
        title={active?.label}
        description={active?.description}
      />

      {section === "profile" && <ProfileEditor />}
      {section === "payments" && <PaymentSettings />}
      {section === "payouts" && <PayoutSettings />}
      {section === "account" && <AccountSettings username={username} />}
    </div>
  );
}

export function Dashboard() {
  const me = useMe();
  const location = useLocation();
  const username = me.data?.username ?? "";
  const settingsMatch = location.pathname.match(
    /^\/dashboard\/settings(?:\/(profile|payments|payouts|account))?\/?$/,
  );
  const isSettings = Boolean(settingsMatch);
  const settingsSection = (settingsMatch?.[1] ??
    null) as SettingsSection | null;

  return (
    <StudioShell
      username={username}
      isSettings={isSettings}
      settingsSection={settingsSection}
    >
      {isSettings ? (
        <CreatorSettings section={settingsSection} username={username} />
      ) : (
        <StudioOverview username={username} />
      )}
    </StudioShell>
  );
}
