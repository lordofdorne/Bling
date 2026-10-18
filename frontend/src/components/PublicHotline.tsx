import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useStripeAppearance } from "../lib/stripe-appearance";
import { useParams } from "react-router-dom";
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FormError, TextField, TextareaField } from "./form-fields";
import { callRequestSchema, type CallRequestValues } from "../lib/schemas";
import { cn } from "@/lib/utils";
import { FollowButton } from "./FollowButton";
import {
  useCreatorProfile,
  useChannelPresence,
  formatCount,
  type CreatorProfile,
} from "../lib/social";
import { CreatorAvatar, CreatorCover } from "./CreatorIdentity";
import { CalendarPlus, Check, Phone, Radio } from "lucide-react";
import { downloadCalendarFile, hotlineEvent } from "../lib/calendar";
import { formatDateTime } from "./studio/format";

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
  // The request lives here, not in the form, so name and topic survive the
  // round trip to the card step and back.
  const form = useForm<CallRequestValues>({
    resolver: zodResolver(callRequestSchema),
    defaultValues: { displayName: "", topic: "", tierId: "", receiptEmail: "" },
  });
  const [pending, setPending] = useState<{
    authorization: PaymentAuthorization & { storageKey: string };
    request: CallRequestValues;
  } | null>(null);
  const authorize = useAuthorizePayment(showID);
  useQueueEvents(showID, "viewer", viewer.data?.entry.status === "WAITING");
  const availableTiers = tiers.data ?? emptyTiers;

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

  if (pending) {
    return (
      <StripeAuthorizationForm
        authorization={pending.authorization}
        displayName={pending.request.displayName}
        topic={pending.request.topic}
        tierID={pending.request.tierId}
        join={join}
        onBack={() => setPending(null)}
        email={me.data?.email}
      />
    );
  }

  return (
    <CallRequestForm
      form={form}
      tiers={availableTiers}
      join={join}
      authorize={authorize}
      onAuthorized={setPending}
      guest={!me.data}
    />
  );
}

function CallRequestForm({
  form,
  tiers,
  join,
  authorize,
  onAuthorized,
  guest,
}: {
  form: UseFormReturn<CallRequestValues>;
  tiers: QueueTier[];
  join: ReturnType<typeof useJoinQueue>;
  authorize: ReturnType<typeof useAuthorizePayment>;
  onAuthorized: (pending: {
    authorization: PaymentAuthorization & { storageKey: string };
    request: CallRequestValues;
  }) => void;
  /** Guests have no account email, so a paid tier asks where to send the receipt. */
  guest: boolean;
}) {
  const chosenTierID = useWatch({ control: form.control, name: "tierId" });
  // Default to the first open tier, and fall back to it if the host removes
  // the one the caller picked.
  const selectedTier =
    tiers.find((tier) => tier.id === chosenTierID) ?? tiers[0];
  const selectedTierID = selectedTier?.id ?? "";
  useEffect(() => {
    if (selectedTierID && chosenTierID !== selectedTierID) {
      form.setValue("tierId", selectedTierID);
    }
  }, [form, chosenTierID, selectedTierID]);

  const submit = form.handleSubmit(async (request) => {
    const tier = tiers.find((value) => value.id === request.tierId);
    if (!tier) return;
    if (tier.priceCents === 0) {
      join.mutate({
        displayName: request.displayName,
        topic: request.topic,
        tierId: request.tierId,
      });
      return;
    }
    if (guest && !request.receiptEmail) {
      form.setError("receiptEmail", {
        message: "Enter an email for your receipt.",
      });
      return;
    }
    try {
      onAuthorized({
        authorization: await authorize.mutateAsync({
          tierID: tier.id,
          receiptEmail: guest ? request.receiptEmail : undefined,
        }),
        request,
      });
    } catch {
      /* rendered below */
    }
  });

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-bold">Request a call</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Tell the host who you are and what you want to talk about.
          </p>
        </div>
        <Form {...form}>
          <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
            <TextField
              control={form.control}
              name="displayName"
              label="Name"
              autoComplete="nickname"
            />
            <TextareaField
              control={form.control}
              name="topic"
              label="What do you want to talk about?"
            />
            {tiers.length > 0 && (
              <FormField
                control={form.control}
                name="tierId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Choose your tier</FormLabel>
                    <FormControl>
                      <RadioGroup
                        value={field.value}
                        onValueChange={field.onChange}
                        aria-label="Choose your tier"
                        className="gap-2"
                      >
                        {tiers.map((tier) => (
                          <label
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
                              field.value === tier.id
                                ? "border-primary bg-primary/5"
                                : "hover:bg-accent",
                            )}
                            key={tier.id}
                          >
                            <RadioGroupItem value={tier.id} />
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
                      </RadioGroup>
                    </FormControl>
                    <FormDescription>
                      Your card is authorized now and charged only if the host
                      selects you.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {guest && (selectedTier?.priceCents ?? 0) > 0 && (
              <TextField
                control={form.control}
                name="receiptEmail"
                label="Email for your receipt"
                type="email"
                inputMode="email"
                autoComplete="email"
                description="Stripe sends your receipt, and any refund notice, here."
              />
            )}
            <Button
              type="submit"
              size="lg"
              disabled={
                join.isPending || authorize.isPending || tiers.length === 0
              }
            >
              {join.isPending || authorize.isPending
                ? "Preparing…"
                : (selectedTier?.priceCents ?? 0) > 0
                  ? "Continue to payment"
                  : "Send call request"}
            </Button>
            <FormError
              error={join.error ?? authorize.error}
              fallback="Unable to send your request. Please try again."
            />
          </form>
        </Form>
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
  const appearance = useStripeAppearance().elements;
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
            appearance,
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
        variant="ghost"
        size="lg"
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
      {profile.data && (
        <div className="flex items-center gap-3">
          <CreatorAvatar profile={profile.data} className="size-12" />
          <div>
            <h2 className="text-lg font-bold">{profile.data.displayName}</h2>
            <p className="text-muted-foreground text-sm">@{username}</p>
          </div>
        </div>
      )}

      {profile.isError &&
        !(
          profile.error instanceof ApiError && profile.error.status === 404
        ) && (
          <Alert variant="destructive">
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
        <Card className="text-muted-foreground px-(--card-pad) py-(--space-9) text-center text-sm">
          Checking the Hotline…
        </Card>
      ) : liveShow.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            Unable to load this Hotline. Please try again.
          </AlertDescription>
        </Alert>
      ) : !liveShow.data ? (
        <Card className="items-center gap-3 px-(--card-pad) py-(--space-9) text-center">
          <span className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-xl">
            <Radio className="size-7" />
          </span>
          {!profile.data && (
            <p className="text-muted-foreground text-sm">@{username}</p>
          )}
          {profile.data?.nextHotlineAt ? (
            <UpcomingHotline profile={profile.data} />
          ) : (
            <>
              <h1 className="text-(length:--text-page-title) font-extrabold tracking-tight">
                Hotline is currently closed.
              </h1>
              <p className="text-muted-foreground text-sm">
                Come back when this creator is live.
              </p>
            </>
          )}
          {profile.data && <FollowButton profile={profile.data} />}
          {profile.data && (
            <p className="text-muted-foreground text-xs">
              {profile.data.bio || `${profile.data.displayName}'s channel`} ·{" "}
              {formatCount(profile.data.followerCount)} followers
            </p>
          )}
        </Card>
      ) : (
        <div className="grid gap-(--section-gap) laptop:grid-cols-[1.1fr_0.9fr] laptop:items-start">
          <section>
            <div
              className="relative mb-(--stack-gap) grid aspect-[2/1] place-items-center overflow-hidden rounded-2xl border border-[var(--mauve-border)] bg-[var(--mauve-surface)] tablet:aspect-auto tablet:h-56"
              aria-hidden="true"
            >
              {profile.data?.coverUrl && (
                <CreatorCover profile={profile.data} />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <span className="bg-background/80 text-primary grid size-20 place-items-center rounded-full">
                <Phone className="size-9" />
              </span>
            </div>
            <Badge className="gap-1.5">
              <span className="bg-primary-foreground size-1.5 animate-pulse rounded-full" />
              Live now
            </Badge>
            <h1 className="mt-3 text-(length:--text-page-title) font-extrabold tracking-tight">
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
          </section>
          <CallerQueue showID={liveShow.data.id} />
        </div>
      )}
    </ViewerShell>
  );
}

/**
 * A creator's announced next Hotline. The page switches to the live line by
 * itself when it opens, so "starting soon" just asks fans to stay.
 */
function UpcomingHotline({ profile }: { profile: CreatorProfile }) {
  const opens = new Date(profile.nextHotlineAt!);
  // A clock that ticks every 30 seconds, so the card turns to "starting
  // soon" on its own while the page is open.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
  const soon = now > 0 && opens.getTime() <= now;
  const addToCalendar = () => {
    const url = `${window.location.origin}/u/${profile.username}`;
    downloadCalendarFile(
      hotlineEvent({
        username: profile.username,
        displayName: profile.displayName,
        start: opens,
        url,
      }),
      `${profile.username}-hotline.ics`,
    );
  };

  return (
    <>
      <Badge variant="secondary">{soon ? "Starting soon" : "Upcoming"}</Badge>
      <h1 className="text-(length:--text-page-title) font-extrabold tracking-tight">
        {soon ? "The Hotline opens any minute." : "Hotline opens"}
      </h1>
      <p className="text-(length:--text-body) font-semibold">
        {soon
          ? `Scheduled for ${formatDateTime(opens)}`
          : formatDateTime(opens)}
      </p>
      <p className="text-muted-foreground text-sm">
        {soon
          ? "Stay on this page; the line opens here."
          : "Follow so you don't miss it, or add it to your calendar."}
      </p>
      {!soon && (
        <Button variant="secondary" type="button" onClick={addToCalendar}>
          <CalendarPlus className="size-4" />
          Add to calendar
        </Button>
      )}
    </>
  );
}
