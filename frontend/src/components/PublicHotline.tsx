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

import { ViewerShell } from "./ViewerShell";
import { FollowButton } from "./FollowButton";
import {
  useCreatorProfile,
  useChannelPresence,
  formatCount,
} from "../lib/social";
import { CreatorAvatar, CreatorCover } from "./CreatorIdentity";
import { UiIcon } from "./UiIcon";

const emptyTiers: QueueTier[] = [];

function CallerQueue({ showID }: { showID: string }) {
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
    return <div className="status">Loading the caller line…</div>;
  if (tiers.isError || viewer.isError || call.isError)
    return (
      <div className="form-error" role="alert">
        Unable to load the caller line.
      </div>
    );

  const state = viewer.data;
  if (
    call.data &&
    call.data.status !== "ENDED" &&
    call.data.status !== "FAILED"
  ) {
    return (
      <section
        className="queue-card queue-confirmation"
        aria-label="Your call status"
      >
        <p className="eyebrow">You’ve been selected</p>
        <div className="position-number">You’re up</div>
        <h2>The host chose your call.</h2>
        <p>Your microphone remains off until you choose to connect.</p>
        <div className="queue-summary">
          <strong>{call.data.caller.tierName}</strong>
          <span>{call.data.callDurationSeconds}s reserved</span>
        </div>
        <CallAudioPanel call={call.data} role="viewer" />
      </section>
    );
  }
  if (call.data?.status === "ENDED" || call.data?.status === "FAILED") {
    return (
      <section
        className="queue-card queue-confirmation"
        aria-label="Call ended"
      >
        <p className="eyebrow">Call complete</p>
        <h2>Thanks for joining the Hotline.</h2>
        <p>Your connection has closed.</p>
      </section>
    );
  }
  if (state?.entry.status === "WAITING") {
    return (
      <section
        className="queue-card queue-confirmation"
        aria-label="Your queue status"
      >
        <p className="eyebrow">You’re in line</p>
        <div className="position-number">#{state.position}</div>
        <h2>Keep this tab open.</h2>
        <p>
          The host can see your request. Your place is safely restored if you
          refresh.
        </p>
        <div className="queue-summary">
          <strong>{state.entry.tierName}</strong>
          <span>{state.entry.callDurationSeconds}s call</span>
        </div>
        <button
          className="danger-button"
          type="button"
          onClick={() => leave.mutate()}
          disabled={leave.isPending}
        >
          {leave.isPending ? "Leaving…" : "Leave the line"}
        </button>
        {leave.isError && (
          <div className="form-error" role="alert">
            Unable to leave the line.
          </div>
        )}
      </section>
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
      />
    );
  }

  return (
    <section className="queue-card">
      <h2>Join the caller line</h2>
      <p>Tell the host who you are and what you want to talk about.</p>
      <form className="auth-form" onSubmit={submit}>
        <label>
          Name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={60}
            required
          />
        </label>
        <label>
          What do you want to talk about?
          <textarea
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            maxLength={280}
            required
          />
        </label>
        {availableTiers.length > 0 && (
          <fieldset className="caller-tier-options">
            <legend>Choose your tier</legend>
            {availableTiers.map((tier, index) => (
              <label className="caller-tier-option" key={tier.id}>
                <input
                  type="radio"
                  name="caller-tier"
                  value={tier.id}
                  checked={effectiveSelectedTierID === tier.id}
                  onChange={() => setSelectedTierID(tier.id)}
                />
                <span>
                  <strong>{tier.name}</strong>
                  <small>
                    {tier.callDurationSeconds}s · {formatPrice(tier.priceCents)}
                    {index === 0 ? " · Highest priority" : ""}
                  </small>
                </span>
              </label>
            ))}
            <p>
              Your card is authorized now and charged only if the host selects
              you.
            </p>
          </fieldset>
        )}
        <button
          className="primary-button"
          type="submit"
          disabled={
            join.isPending || authorize.isPending || availableTiers.length === 0
          }
        >
          {join.isPending || authorize.isPending
            ? "Preparing…"
            : (selectedTier?.priceCents ?? 0) > 0
              ? "Continue to payment"
              : "Join the line"}
        </button>
        {(join.isError || authorize.isError) && (
          <div className="form-error" role="alert">
            {join.error?.message ?? authorize.error?.message}
          </div>
        )}
      </form>
    </section>
  );
}

function StripeAuthorizationForm({
  authorization,
  displayName,
  topic,
  tierID,
  join,
  onBack,
}: {
  authorization: PaymentAuthorization & { storageKey: string };
  displayName: string;
  topic: string;
  tierID: string;
  join: ReturnType<typeof useJoinQueue>;
  onBack: () => void;
}) {
  const stripePromise = useMemo(
    () => loadStripe(authorization.publishableKey),
    [authorization.publishableKey],
  );
  return (
    <section className="queue-card payment-card">
      <p className="eyebrow">Secure payment</p>
      <h2>Authorize {formatPrice(authorization.amountCents)}</h2>
      <p>
        This is a temporary card hold. You are charged only if the host selects
        your call.
      </p>
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: authorization.clientSecret,
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
        />
      </Elements>
    </section>
  );
}

function ConfirmAuthorization({
  authorization,
  displayName,
  topic,
  tierID,
  join,
  onBack,
}: {
  authorization: PaymentAuthorization & { storageKey: string };
  displayName: string;
  topic: string;
  tierID: string;
  join: ReturnType<typeof useJoinQueue>;
  onBack: () => void;
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
    <div className="stripe-payment-form">
      <PaymentElement options={{ layout: "tabs" }} />
      <button
        className="primary-button"
        type="button"
        onClick={confirm}
        disabled={!stripe || submitting || join.isPending}
      >
        {submitting || join.isPending ? "Authorizing…" : "Authorize and join"}
      </button>
      <button
        className="button secondary"
        type="button"
        onClick={onBack}
        disabled={submitting}
      >
        Back
      </button>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
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
      <Link className="back-link" to="/">
        ← Back to discover
      </Link>
      {profile.data && (
        <div className="public-profile-bar">
          <CreatorAvatar profile={profile.data} />
          <div>
            <h2>{profile.data.displayName}</h2>
            <p>{profile.data.category}</p>
          </div>
        </div>
      )}
      {profile.isError && !(profile.error instanceof ApiError && profile.error.status === 404) && <div className="form-error" role="alert">Could not load channel details. <button className="text-button" onClick={()=>void profile.refetch()}>Retry profile</button></div>}
      {liveShow.isPending ? (
        <div className="channel-state">
          <div className="status">Checking the Hotline…</div>
        </div>
      ) : liveShow.isError ? (
        <div className="channel-state">
          <div className="form-error" role="alert">
            Unable to load this Hotline. Please try again.
          </div>
        </div>
      ) : !liveShow.data ? (
        <section className="channel-state channel-offline">
          <span className="feature-icon">
            <UiIcon name="broadcast" size={32} />
          </span>
          <p className="eyebrow">@{username}</p>
          <h1>Hotline is currently closed.</h1>
          <p className="lede">Come back when this creator is live.</p>
          {profile.data && <FollowButton profile={profile.data} />}
          {profile.data && (
            <p className="muted">
              {profile.data.bio || `${profile.data.displayName}'s channel`} ·{" "}
              {formatCount(profile.data.followerCount)} followers
            </p>
          )}
        </section>
      ) : (
        <div className="hotline-page">
          <section className="hotline-heading">
            <div className="channel-live-art" aria-hidden="true">
              {profile.data?.coverUrl ? (
                <CreatorCover profile={profile.data} />
              ) : (
                <div className="channel-live-rings" />
              )}
              <span className="studio-mic">
                <UiIcon name="call" size={42} />
              </span>
              <span className="sound-bars">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="channel-art-caption">
                LESS DISTANCE. MORE CONNECTION.
              </span>
            </div>
            <div className="live-badge">
              <span /> Live now
            </div>
            <p className="eyebrow">@{username}</p>
            <h1>The Hotline is open.</h1>
            {profile.data?.bio && (
              <p className="channel-bio">{profile.data.bio}</p>
            )}
            <p className="lede">
              Join the line for a chance to speak with the host live.
            </p>
            {profile.data && <FollowButton profile={profile.data} />}
            {profile.data && (
              <p className="muted">
                {formatCount(profile.data.followerCount)} followers
                {profile.data.channelVisitors !== null
                  ? ` · ${formatCount(profile.data.channelVisitors)} on this channel page`
                  : ""}
              </p>
            )}
            <div className="hotline-how">
              <span>
                <b>01</b> Choose your tier
              </span>
              <span>
                <b>02</b> Join the line
              </span>
              <span>
                <b>03</b> Have your moment
              </span>
            </div>
          </section>
          <CallerQueue showID={liveShow.data.id} />
        </div>
      )}
    </ViewerShell>
  );
}
