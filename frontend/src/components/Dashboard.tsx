import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Phone, Plus, Radio, Users, Wallet } from "lucide-react";
import { ApiError } from "../lib/api";
import { useMe } from "../lib/auth";
import { usePayoutStatus } from "../lib/payouts";
import { usePaymentActivity } from "../lib/finance";
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
import { StudioShell, type SettingsSection } from "./studio/StudioShell";
import { activityLabel, formatPrice } from "./studio/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Grid, GridItem } from "./Grid";

function OverviewStat({
  icon: Icon,
  label,
  value,
  note,
  live,
}: {
  icon: typeof Radio;
  label: string;
  value: string;
  note: string;
  live?: boolean;
}) {
  return (
    <Card className="gap-0 py-5">
      <CardContent className="px-5">
        <span className="text-muted-foreground flex items-center gap-2 text-xs font-semibold">
          <Icon className="size-4 text-[var(--sand-text)]" />
          {label}
          {live && (
            <span className="ml-auto flex items-center gap-1.5 text-[var(--green-light)]">
              <span className="size-2 animate-pulse rounded-full bg-current" />
            </span>
          )}
        </span>
        <strong className="mt-3 block text-xl font-semibold tracking-tight">
          {value}
        </strong>
        <small className="text-muted-foreground mt-1 block text-xs">
          {note}
        </small>
      </CardContent>
    </Card>
  );
}

function StudioOverview({ username }: { username: string }) {
  const currentShow = useCurrentShow();
  const createShow = useCreateShow();
  const startShow = useStartShow(username);
  const endShow = useEndShow(username);
  const payouts = usePayoutStatus();
  const paymentActivity = usePaymentActivity();
  const activeShow = currentShow.data;

  return (
    <>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
            Your channel, at a glance
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
            Welcome, {username}.
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            A little preparation. A great conversation. Let’s make it happen.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link to={`/u/${username}`}>
            View channel <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>

      <Grid className="mb-8" aria-label="Channel overview">
        <GridItem span={4} tablet={4} phone={4}>
          <OverviewStat
            icon={Radio}
            label="Hotline status"
            live={activeShow?.status === "LIVE"}
            value={
              currentShow.isPending
                ? "Loading…"
                : currentShow.isError
                  ? "Unavailable"
                  : activeShow?.status === "LIVE"
                    ? "On air"
                    : activeShow?.status === "CREATED"
                      ? "In preparation"
                      : "Offline"
            }
            note={
              activeShow?.status === "LIVE"
                ? "Your audience can join the line"
                : "Your next conversation starts here"
            }
          />
        </GridItem>
        <GridItem span={4} tablet={4} phone={4}>
          <OverviewStat
            icon={Wallet}
            label="Payout account"
            value={
              payouts.isPending
                ? "Loading…"
                : payouts.isError
                  ? "Unavailable"
                  : payouts.data.ready
                    ? "Connected"
                    : "Set up payouts"
            }
            note={
              payouts.data
                ? `${100 - payouts.data.platformFeePercent}% creator share, less half the basic card fee`
                : "Set up payouts to charge for calls"
            }
          />
        </GridItem>
        <GridItem span={4} tablet={4} phone={4}>
          <OverviewStat
            icon={Users}
            label="Grow your community"
            value="Make it personal."
            note="Invite your audience to your public page"
          />
        </GridItem>
      </Grid>

      <Grid>
        <GridItem span={7} tablet={8} phone={4}>
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
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <span className="bg-muted text-primary grid size-16 place-items-center rounded-full">
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
        </GridItem>
        <GridItem span={5} tablet={8} phone={4}>
          <Card id="payment-activity" aria-label="Payment activity">
            <CardContent className="flex flex-col gap-3">
              <div>
                <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
                  Payment activity
                </p>
                <h2 className="mt-1 text-lg font-bold">Recent paid calls</h2>
              </div>
              {paymentActivity.isPending ? (
                <p className="text-muted-foreground text-sm">
                  Loading payment activity…
                </p>
              ) : paymentActivity.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    Unable to load payment activity.
                  </AlertDescription>
                </Alert>
              ) : paymentActivity.data.activity.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <span className="bg-muted text-muted-foreground grid size-12 place-items-center rounded-xl">
                    <Wallet className="size-5" />
                  </span>
                  <strong className="text-sm">No paid calls yet.</strong>
                  <p className="text-muted-foreground max-w-xs text-xs">
                    Your paid call activity will appear here after your first
                    conversation.
                  </p>
                </div>
              ) : (
                <ol className="flex flex-col">
                  {paymentActivity.data.activity.map((activity) => (
                    <li
                      key={activity.paymentAttemptId}
                      className="flex flex-col gap-1 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <strong className="text-sm font-semibold">
                          {formatPrice(activity.amountCents)}
                        </strong>
                        <span className="text-muted-foreground text-xs">
                          {activityLabel(activity)}
                        </span>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        Creator share:{" "}
                        {formatPrice(
                          activity.amountCents - activity.platformFeeCents,
                        )}
                        {activity.creatorProcessingFeeCents > 0
                          ? ` · includes your ${formatPrice(activity.creatorProcessingFeeCents)} half of the card fee`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </GridItem>
      </Grid>
    </>
  );
}

function CreatorSettings({
  section,
  username,
}: {
  section: SettingsSection;
  username: string;
}) {
  const tabs: { id: SettingsSection; label: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "payments", label: "Payments" },
    { id: "payouts", label: "Payouts" },
    { id: "account", label: "Account" },
  ];
  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
          Creator studio
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Settings
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Manage your public presence, appearance, payouts, and account.
        </p>
      </header>

      <Tabs value={section}>
        <TabsList
          aria-label="Settings sections"
          className="w-full self-start sm:w-auto"
        >
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} asChild>
              <Link
                to={`/dashboard/settings/${tab.id}`}
                aria-current={section === tab.id ? "page" : undefined}
              >
                {tab.label}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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
  const settingsSection = (settingsMatch?.[1] ?? "profile") as SettingsSection;

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
