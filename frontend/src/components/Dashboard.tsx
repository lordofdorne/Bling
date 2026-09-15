import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Phone, Plus, Radio, Settings } from "lucide-react";
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

function StudioOverview({ username }: { username: string }) {
  const currentShow = useCurrentShow();
  const createShow = useCreateShow();
  const startShow = useStartShow(username);
  const endShow = useEndShow(username);
  const controlSize = useControlSize();
  const activeShow = currentShow.data;

  return (
    <>
      <div className="mb-6">
        <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
          Creator studio
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          {activeShow?.status === "LIVE"
            ? "You’re live."
            : `Welcome, ${username}.`}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Manage your Hotline and connect with the people waiting to talk.
        </p>
      </div>

      <Card className="mb-6 py-3" aria-label="Channel status">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                activeShow?.status === "LIVE"
                  ? "bg-primary ring-primary/20 ring-4"
                  : "bg-muted-foreground",
              )}
            />
            <span className="flex flex-wrap items-baseline gap-2">
              <strong className="text-sm">
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
              <small className="text-muted-foreground text-xs">
                {activeShow?.status === "LIVE"
                  ? "Your public line is open"
                  : "Your public line is closed"}
              </small>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard/settings">
                <Settings className="size-4" />
                Settings
              </Link>
            </Button>
            <Button asChild variant="secondary" size={controlSize}>
              <Link to={`/u/${username}`}>
                View channel <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card id="hotline-controls" aria-label="Hotline controls">
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Radio className="size-4" />
              Stream manager
            </span>
            <span className="text-muted-foreground text-[10px] font-bold tracking-[0.14em] uppercase">
              Live control room
            </span>
          </div>

          {currentShow.isPending ? (
            <p className="text-muted-foreground text-sm">
              Loading show status…
            </p>
          ) : currentShow.isError ? (
            <Alert variant="destructive">
              <AlertDescription>
                Unable to load your Hotline status.
              </AlertDescription>
            </Alert>
          ) : activeShow?.status === "LIVE" ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Badge className="gap-1.5">
                    <span className="bg-primary-foreground size-1.5 animate-pulse rounded-full" />
                    Hotline live
                  </Badge>
                  <h2 className="mt-2 text-xl font-bold">
                    Your audience can join.
                  </h2>
                </div>
                <Button
                  variant="destructive"
                  size={controlSize}
                  type="button"
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
            </>
          ) : activeShow?.status === "CREATED" ? (
            <TierConfiguration
              showID={activeShow.id}
              starting={startShow.isPending}
              onStart={() => startShow.mutate(activeShow.id)}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <span className="border-border-strong bg-background grid size-14 place-items-center rounded-2xl border text-[var(--sand-text)]">
                <Phone className="size-7" />
              </span>
              <Badge variant="secondary">Off air</Badge>
              <h2 className="text-xl font-bold">No active Hotline</h2>
              <p className="text-muted-foreground max-w-sm text-sm">
                Create a draft to configure caller priority, duration, and
                pricing before opening your public page.
              </p>
              <Button
                type="button"
                size={controlSize}
                onClick={() => createShow.mutate()}
                disabled={createShow.isPending}
              >
                <Plus className="size-4" />
                {createShow.isPending ? "Creating…" : "Set up Hotline"}
              </Button>
            </div>
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
        </CardContent>
      </Card>
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
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-muted-foreground mb-4 flex items-center gap-2 text-xs">
          <Link to="/dashboard/settings" className="hover:text-foreground">
            Settings
          </Link>
          <span>/</span>
          {active?.label}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          {active?.label}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {active?.description}
        </p>
      </header>

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
