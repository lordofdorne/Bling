import { FormEvent, useMemo, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Link, useParams } from "react-router-dom";
import {
  QueueTier,
  useJoinQueue,
  useLeaveQueue,
  useQueueEvents,
  useQueueTiers,
  useViewerQueue,
} from "../lib/queue";
import { ApiError } from "../lib/api";
import { useLiveShow } from "../lib/shows";
import { useViewerCall } from "../lib/calls";
import { CallAudioPanel } from "./CallAudioPanel";
import { PaymentAuthorization, useAuthorizePayment } from "../lib/payments";
import { useMe } from "../lib/auth";

import { ViewerShell } from "./ViewerShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FollowButton } from "./FollowButton";
import {
  useCreatorProfile,
  useChannelPresence,
  formatCount,
} from "../lib/social";
import { CreatorAvatar, CreatorCover } from "./CreatorIdentity";
import { ArrowLeft, Check, Phone, Radio } from "lucide-react";

const emptyTiers: QueueTier[] = [];

function formatCallLength(seconds: number) {
  const minutes = seconds / 60;
  return `${Number(minutes.toFixed(2))} ${minutes === 1 ? "minute" : "minutes"}`;
}

function CallerQueue({ showID }: { showID: string }) {
  const me = useMe();
  const tiers = useQueueTiers(showID);
  const viewer = useViewerQueue(showID);
  const join = useJoinQueue(showID);
  const leave = useLeaveQueue(showID);
  const call = useViewerCall(showID);
  const [displayName, setDisplayName] = useState("");
  const [topic, setTopic] = useState("");
  const [selectedTierID, setSelectedTierID] = useState("");
  const [authorization, setAuthorization] = useState<
    (PaymentAuthorization & { storageKey: string }) | null
  >(null);
  const authorize = useAuthorizePayment(showID);
  useQueueEvents(showID, "viewer", viewer.data?.entry.status === "WAITING");
  const availableTiers = tiers.data ?? emptyTiers;
  const effectiveSelectedTierID = availableTiers.some(
    (tier) => tier.id === selectedTierID,
  )
    ? selectedTierID
    : (availableTiers[0]?.id ?? "");
  const selectedTier = availableTiers.find(
    (tier) => tier.id === effectiveSelectedTierID,
  );

  if (tiers.isPending || viewer.isPending || call.isPending)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Loading the caller line…
      </Card>
    );
  if (tiers.isError || viewer.isError || call.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>Unable to load the caller line.</AlertDescription>
      </Alert>
    );

  const state = viewer.data;
  if (
    call.data &&
    call.data.status !== "ENDED" &&
    call.data.status !== "FAILED"
  ) {
    return (
      <Card aria-label="Your call status">
        <CardContent className="flex flex-col items-start gap-3">
          <Badge className="gap-1.5">
            <Phone className="size-3" />
            You’re up
          </Badge>
          <h2 className="text-xl font-bold">The host chose your call.</h2>
          <p className="text-muted-foreground text-sm">
            Your microphone remains off until you choose to connect.
          </p>
          <div className="bg-muted flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm">
            <strong>{call.data.caller.tierName}</strong>
            <span className="text-muted-foreground">
              {formatCallLength(call.data.callDurationSeconds)} reserved
            </span>
          </div>
          <CallAudioPanel call={call.data} role="viewer" />
        </CardContent>
      </Card>
    );
  }
  if (call.data?.status === "ENDED" || call.data?.status === "FAILED") {
    return (
      <Card aria-label="Call ended">
        <CardContent className="flex flex-col gap-2">
          <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
            Call complete
          </p>
          <h2 className="text-xl font-bold">Thanks for joining the Hotline.</h2>
          <p className="text-muted-foreground text-sm">
            Your connection has closed.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (state?.entry.status === "WAITING") {
    return (
      <Card aria-label="Your call request status">
        <CardContent className="flex flex-col items-start gap-3">
          <Badge variant="success" className="gap-1.5">
            <Check className="size-3" />
            The host can see you
          </Badge>
          <h2 className="text-xl font-bold">Keep this tab open.</h2>
          <p className="text-muted-foreground text-sm">
            The host reviews every request and chooses who to call. Your request
            is safely restored if you refresh.
          </p>
          <div className="bg-muted flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm">
            <strong>{state.entry.tierName}</strong>
            <span className="text-muted-foreground">
              {formatCallLength(state.entry.callDurationSeconds)} call
            </span>
          </div>
          <Button
            variant="destructive"
            type="button"
            onClick={() => leave.mutate()}
            disabled={leave.isPending}
          >
            {leave.isPending ? "Removing…" : "Withdraw request"}
          </Button>
          {leave.isError && (
            <Alert variant="destructive">
              <AlertDescription>Unable to leave the line.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tier = availableTiers.find(
      (value) => value.id === effectiveSelectedTierID,
    );
    if (!tier) return;
    if (tier.priceCents === 0) {
      join.mutate({ displayName, topic, tierId: tier.id });
      return;
    }
    try {
      setAuthorization(await authorize.mutateAsync(tier.id));
    } catch {
      /* rendered below */
    }
  }

  if (authorization) {
    return (
      <StripeAuthorizationForm
        authorization={authorization}
        displayName={displayName}
        topic={topic}
        tierID={effectiveSelectedTierID}
        join={join}
        onBack={() => setAuthorization(null)}
        email={me.data?.email}
      />
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-bold">Request a call</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Tell the host who you are and what you want to talk about.
          </p>
        </div>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="caller-name">Name</Label>
            <Input
              id="caller-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={60}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="caller-topic">
              What do you want to talk about?
            </Label>
            <Textarea
              id="caller-topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              maxLength={280}
              required
            />
          </div>
          {availableTiers.length > 0 && (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">
                Choose your tier
              </legend>
              {availableTiers.map((tier) => (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
                    effectiveSelectedTierID === tier.id
                      ? "border-primary bg-primary/5"
                      : "hover:bg-accent",
                  )}
                  key={tier.id}
                >
                  <input
                    type="radio"
                    name="caller-tier"
                    className="accent-[var(--accent)]"
                    value={tier.id}
                    checked={effectiveSelectedTierID === tier.id}
                    onChange={() => setSelectedTierID(tier.id)}
                  />
                  <span className="flex-1">
                    <strong className="block text-sm font-semibold">
                      {tier.name}
                    </strong>
                    <small className="text-muted-foreground text-xs">
                      {formatCallLength(tier.callDurationSeconds)} ·{" "}
                      {formatPrice(tier.priceCents)}
                    </small>
                  </span>
                </label>
              ))}
              <p className="text-muted-foreground text-xs">
                Your card is authorized now and charged only if the host selects
                you.
              </p>
            </fieldset>
          )}
          <Button
            type="submit"
            size="lg"
            disabled={
              join.isPending ||
              authorize.isPending ||
              availableTiers.length === 0
            }
          >
            {join.isPending || authorize.isPending
              ? "Preparing…"
              : (selectedTier?.priceCents ?? 0) > 0
                ? "Continue to payment"
                : "Send call request"}
          </Button>
          {(join.isError || authorize.isError) && (
            <Alert variant="destructive">
              <AlertDescription>
                {join.error?.message ?? authorize.error?.message}
              </AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function StripeAuthorizationForm({
  authorization,
  displayName,
  topic,
  tierID,
  join,
  onBack,
  email,
}: {
  authorization: PaymentAuthorization & { storageKey: string };
  displayName: string;
  topic: string;
  tierID: string;
  join: ReturnType<typeof useJoinQueue>;
  onBack: () => void;
  email?: string;
}) {
  const stripePromise = useMemo(
    () => loadStripe(authorization.publishableKey),
    [authorization.publishableKey],
  );
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
            Secure payment
          </p>
          <h2 className="mt-1 text-xl font-bold">
            Authorize {formatPrice(authorization.amountCents)}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            This is a temporary card hold. You are charged only if the host
            selects your call.
          </p>
        </div>
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret: authorization.clientSecret,
            customerSessionClientSecret:
              authorization.customerSessionClientSecret,
            appearance: { theme: "stripe" },
          }}
        >
          <ConfirmAuthorization
            authorization={authorization}
            displayName={displayName}
            topic={topic}
            tierID={tierID}
            join={join}
            onBack={onBack}
            email={email}
          />
        </Elements>
      </CardContent>
    </Card>
  );
}

function ConfirmAuthorization({
  authorization,
  displayName,
  topic,
  tierID,
  join,
  onBack,
  email,
}: {
  authorization: PaymentAuthorization & { storageKey: string };
  displayName: string;
  topic: string;
  tierID: string;
  join: ReturnType<typeof useJoinQueue>;
  onBack: () => void;
  email?: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function confirm() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError("");
    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: window.location.href },
    });
    if (result.error) {
      setError(result.error.message ?? "Payment authorization failed.");
      setSubmitting(false);
      return;
    }
    if (result.paymentIntent?.status !== "requires_capture") {
      setError("The card was not authorized. Try another payment method.");
      setSubmitting(false);
      return;
    }
    try {
      await join.mutateAsync({
        displayName,
        topic,
        tierId: tierID,
        paymentAttemptId: authorization.attemptId,
      });
      sessionStorage.removeItem(authorization.storageKey);
    } catch (joinError) {
      setError(
        joinError instanceof Error
          ? joinError.message
          : "Unable to join the line.",
      );
      setSubmitting(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="[&_.StripeElement]:rounded-md">
        <PaymentElement
          options={{
            layout: "tabs",
            defaultValues: email ? { billingDetails: { email } } : undefined,
          }}
        />
      </div>
      <Button
        type="button"
        size="lg"
        onClick={confirm}
        disabled={!stripe || submitting || join.isPending}
      >
        {submitting || join.isPending ? "Authorizing…" : "Authorize and join"}
      </Button>
      <Button
        variant="secondary"
        type="button"
        onClick={onBack}
        disabled={submitting}
      >
        Back
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function formatPrice(cents: number) {
  return cents === 0
    ? "Free"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(cents / 100);
}

export function PublicHotline() {
  const { username = "" } = useParams();
  const liveShow = useLiveShow(username.toLowerCase());
  const profile = useCreatorProfile(username.toLowerCase());
  useChannelPresence(username.toLowerCase(), Boolean(liveShow.data));

  return (
    <ViewerShell>
      <Button asChild variant="link" className="mb-4 h-auto px-0">
        <Link to="/">
          <ArrowLeft className="size-4" />
          Back to discover
        </Link>
      </Button>

      {profile.data && (
        <div className="mb-6 flex items-center gap-3">
          <CreatorAvatar profile={profile.data} className="size-12" />
          <div>
            <h2 className="text-lg font-bold">{profile.data.displayName}</h2>
            <p className="text-muted-foreground text-sm">
              {profile.data.category}
            </p>
          </div>
        </div>
      )}

      {profile.isError &&
        !(
          profile.error instanceof ApiError && profile.error.status === 404
        ) && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>
              Could not load channel details.
              <Button
                variant="link"
                className="h-auto px-2"
                onClick={() => void profile.refetch()}
              >
                Retry profile
              </Button>
            </AlertDescription>
          </Alert>
        )}

      {liveShow.isPending ? (
        <Card className="text-muted-foreground p-10 text-center text-sm">
          Checking the Hotline…
        </Card>
      ) : liveShow.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            Unable to load this Hotline. Please try again.
          </AlertDescription>
        </Alert>
      ) : !liveShow.data ? (
        <Card className="items-center gap-3 p-10 text-center">
          <span className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-xl">
            <Radio className="size-7" />
          </span>
          <p className="text-muted-foreground text-sm">@{username}</p>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Hotline is currently closed.
          </h1>
          <p className="text-muted-foreground text-sm">
            Come back when this creator is live.
          </p>
          {profile.data && <FollowButton profile={profile.data} />}
          {profile.data && (
            <p className="text-muted-foreground text-xs">
              {profile.data.bio || `${profile.data.displayName}'s channel`} ·{" "}
              {formatCount(profile.data.followerCount)} followers
            </p>
          )}
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <section>
            <div
              className="relative mb-6 grid h-56 place-items-center overflow-hidden rounded-2xl border border-[var(--mauve-border)] bg-[var(--mauve-surface)]"
              aria-hidden="true"
            >
              {profile.data?.coverUrl && (
                <CreatorCover profile={profile.data} />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <span className="bg-background/80 text-primary grid size-20 place-items-center rounded-full">
                <Phone className="size-9" />
              </span>
              <span className="absolute bottom-4 text-[11px] font-bold tracking-[0.18em] text-white/80 uppercase">
                Less distance. More connection.
              </span>
            </div>
            <Badge className="gap-1.5">
              <span className="bg-primary-foreground size-1.5 animate-pulse rounded-full" />
              Live now
            </Badge>
            <p className="text-muted-foreground mt-3 text-sm">@{username}</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
              The Hotline is open.
            </h1>
            {profile.data?.bio && (
              <p className="text-muted-foreground mt-3 max-w-prose text-sm">
                {profile.data.bio}
              </p>
            )}
            <p className="mt-3 text-sm">
              Join the line for a chance to speak with the host live.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {profile.data && <FollowButton profile={profile.data} />}
              {profile.data && (
                <p className="text-muted-foreground text-xs">
                  {formatCount(profile.data.followerCount)} followers
                  {profile.data.channelVisitors !== null
                    ? ` · ${formatCount(profile.data.channelVisitors)} on this channel page`
                    : ""}
                </p>
              )}
            </div>
            <ol className="text-muted-foreground mt-6 flex flex-wrap gap-4 text-xs">
              {["Choose your tier", "Join the line", "Have your moment"].map(
                (step, index) => (
                  <li key={step} className="flex items-center gap-2">
                    <b className="text-[var(--sand-text)] font-bold">
                      0{index + 1}
                    </b>
                    {step}
                  </li>
                ),
              )}
            </ol>
          </section>
          <CallerQueue showID={liveShow.data.id} />
        </div>
      )}
    </ViewerShell>
  );
}
