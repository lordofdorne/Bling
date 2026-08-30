import { FormEvent, useState } from "react";
import { useParams } from "react-router-dom";
import {
  QueueTier,
  useJoinQueue,
  useLeaveQueue,
  useQueueEvents,
  useQueueTiers,
  useViewerQueue,
} from "../lib/queue";
import { useLiveShow } from "../lib/shows";
import { useViewerCall } from "../lib/calls";
import { CallAudioPanel } from "./CallAudioPanel";

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
  useQueueEvents(showID, "viewer", viewer.data?.entry.status === "WAITING");
  const availableTiers = tiers.data ?? emptyTiers;
  const effectiveSelectedTierID = availableTiers.some(
    (tier) => tier.id === selectedTierID,
  )
    ? selectedTierID
    : (availableTiers[0]?.id ?? "");

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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    join.mutate({
      displayName,
      topic,
      tierId: effectiveSelectedTierID,
    });
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
            <p>Payments are not collected in this test build.</p>
          </fieldset>
        )}
        <button
          className="primary-button"
          type="submit"
          disabled={join.isPending || availableTiers.length === 0}
        >
          {join.isPending ? "Joining…" : "Join the line"}
        </button>
        {join.isError && (
          <div className="form-error" role="alert">
            {join.error.message}
          </div>
        )}
      </form>
    </section>
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

  if (liveShow.isPending) {
    return (
      <main className="page centered">
        <div className="status">Checking the Hotline…</div>
      </main>
    );
  }
  if (liveShow.isError) {
    return (
      <main className="page centered">
        <div className="form-error" role="alert">
          Unable to load this Hotline. Please try again.
        </div>
      </main>
    );
  }
  if (!liveShow.data) {
    return (
      <main className="page centered">
        <p className="eyebrow">@{username}</p>
        <h1>Hotline is currently closed.</h1>
        <p className="lede">Come back when this creator is live.</p>
      </main>
    );
  }
  return (
    <main className="page hotline-page">
      <section className="hotline-heading">
        <div className="live-badge">
          <span /> Live now
        </div>
        <p className="eyebrow">@{username}</p>
        <h1>The Hotline is open.</h1>
        <p className="lede">
          Join the line for a chance to speak with the host live.
        </p>
      </section>
      <CallerQueue showID={liveShow.data.id} />
    </main>
  );
}
