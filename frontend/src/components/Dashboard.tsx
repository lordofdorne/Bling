import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLogout, useMe } from "../lib/auth";
import {
  useActiveCall,
  useSelectCaller,
  useSelectRandomCaller,
} from "../lib/calls";
import { useCreatorQueue, useQueueEvents } from "../lib/queue";
import { usePayoutOnboarding, usePayoutStatus } from "../lib/payouts";
import { PaymentActivity, usePaymentActivity } from "../lib/finance";
import {
  HotlineTier,
  useCreateShow,
  useCurrentShow,
  useEndShow,
  useSaveTierConfiguration,
  useStartShow,
  useTierConfiguration,
} from "../lib/shows";
import { ProfileEditor } from "./ProfileEditor";
import { CallAudioPanel } from "./CallAudioPanel";
import { UiIcon } from "./UiIcon";
import { Brand } from "./ViewerShell";

function CallerList({ showID }: { showID: string }) {
  const queue = useCreatorQueue(showID);
  const activeCall = useActiveCall(showID);
  const selectCaller = useSelectCaller(showID);
  const selectRandom = useSelectRandomCaller(showID);
  useQueueEvents(showID, "creator", true);
  if (queue.isPending || activeCall.isPending)
    return <div className="status">Loading caller queue…</div>;
  if (queue.isError || activeCall.isError)
    return (
      <div className="form-error" role="alert">
        Unable to load the caller queue.
      </div>
    );
  const entries = queue.data ?? [];
  const call = activeCall.data;
  return (
    <section className="caller-list" aria-label="Caller queue">
      <div className="caller-list-heading">
        <div>
          <h2>Caller queue</h2>
          <span>{entries.length} waiting</span>
        </div>
        {!call && entries.length > 0 && (
          <button
            className="button secondary"
            type="button"
            onClick={() => selectRandom.mutate(undefined)}
            disabled={selectRandom.isPending}
          >
            {selectRandom.isPending ? "Choosing…" : "Choose priority random"}
          </button>
        )}
      </div>
      {call && (
        <div className="active-call-card" aria-label="Active call">
          <p className="eyebrow">{call.status.replace("_", " ")}</p>
          <strong>{call.caller.displayName}</strong>
          <p>{call.caller.topic}</p>
          <span>
            {call.caller.tierName} · {call.callDurationSeconds}s reserved
          </span>
          {call.status === "PAYMENT_PENDING" ? (
            <p>
              Stripe is confirming the charge. Audio stays closed until capture
              succeeds.
            </p>
          ) : (
            <CallAudioPanel call={call} role="creator" />
          )}
        </div>
      )}
      {entries.length === 0 ? (
        <p className="empty-queue">
          Share your public URL. Callers will appear here.
        </p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{entry.displayName}</strong>
                <span>
                  {entry.tierName} · {entry.callDurationSeconds}s ·{" "}
                  {entry.tierPriceCents > 0
                    ? `${formatPrice(entry.tierPriceCents)} authorized`
                    : "Free"}
                </span>
              </div>
              <p>{entry.topic}</p>
              <button
                className="button secondary"
                type="button"
                onClick={() => selectCaller.mutate(entry.id)}
                disabled={Boolean(call) || selectCaller.isPending}
              >
                Select caller
              </button>
            </li>
          ))}
        </ol>
      )}
      {(selectCaller.isError || selectRandom.isError) && (
        <div className="form-error" role="alert">
          Unable to update the active call. Refresh and try again.
        </div>
      )}
    </section>
  );
}

function formatPrice(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function activityLabel(activity: PaymentActivity) {
  if (activity.disputeStatus) return `Dispute: ${activity.disputeStatus}`;
  if (activity.refundStatus === "SUCCEEDED") return "Refunded";
  if (activity.refundStatus === "FAILED") return "Refund needs attention";
  if (activity.refundStatus) return "Refund in progress";
  return "Paid call";
}

type TierDraft = Pick<
  HotlineTier,
  "name" | "callDurationSeconds" | "priceCents" | "enabled"
> & { key: string };

function TierConfiguration({
  showID,
  onStart,
  starting,
  payoutsReady,
}: {
  showID: string;
  onStart: () => void;
  starting: boolean;
  payoutsReady: boolean;
}) {
  const configuration = useTierConfiguration(showID);
  if (configuration.isPending)
    return <div className="status">Loading Hotline tiers…</div>;
  if (configuration.isError)
    return (
      <div className="form-error" role="alert">
        Unable to load the tier configuration.
      </div>
    );
  return (
    <TierConfigurationForm
      key={configuration.data
        .map((tier) => `${tier.id}:${tier.updatedAt}`)
        .join(":")}
      showID={showID}
      initialTiers={configuration.data}
      onStart={onStart}
      starting={starting}
      payoutsReady={payoutsReady}
    />
  );
}

function TierConfigurationForm({
  showID,
  initialTiers,
  onStart,
  starting,
  payoutsReady,
}: {
  showID: string;
  initialTiers: HotlineTier[];
  onStart: () => void;
  starting: boolean;
  payoutsReady: boolean;
}) {
  const save = useSaveTierConfiguration(showID);
  const [tiers, setTiers] = useState<TierDraft[]>(() =>
    initialTiers.map((tier) => ({
      key: tier.id,
      name: tier.name,
      callDurationSeconds: tier.callDurationSeconds,
      priceCents: tier.priceCents,
      enabled: tier.enabled,
    })),
  );
  const [dirty, setDirty] = useState(false);

  const hasEnabledPaidTier = tiers.some(
    (tier) => tier.enabled && tier.priceCents > 0,
  );

  function update(index: number, patch: Partial<TierDraft>) {
    setTiers((current) =>
      current.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, ...patch } : tier,
      ),
    );
    setDirty(true);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= tiers.length) return;
    setTiers((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  }

  async function saveChanges() {
    try {
      await save.mutateAsync(
        tiers.map(({ name, callDurationSeconds, priceCents, enabled }) => ({
          name,
          callDurationSeconds,
          priceCents,
          enabled,
        })),
      );
    } catch {
      // Mutation state renders the server-safe error below.
    }
  }

  return (
    <div className="tier-configuration">
      <div>
        <p className="eyebrow">Hotline setup</p>
        <h2>Configure caller tiers</h2>
        <p>
          Higher rows are selected first. Paid tiers authorize cards at queue
          entry and capture only when you select a caller.
        </p>
      </div>
      <div className="tier-editor-list">
        {tiers.map((tier, index) => (
          <fieldset className="tier-editor" key={tier.key}>
            <legend>Priority {index + 1}</legend>
            <label>
              Tier name
              <input
                value={tier.name}
                maxLength={40}
                onChange={(event) =>
                  update(index, { name: event.target.value })
                }
              />
            </label>
            <label>
              Call length (seconds)
              <input
                type="number"
                min={30}
                max={3600}
                value={tier.callDurationSeconds}
                onChange={(event) =>
                  update(index, {
                    callDurationSeconds: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Price (USD)
              <input
                type="number"
                min={0}
                max={10000}
                step="0.01"
                value={(tier.priceCents / 100).toFixed(2)}
                onChange={(event) =>
                  update(index, {
                    priceCents: Math.round(Number(event.target.value) * 100),
                  })
                }
              />
              <small>Use $0 for free or at least $0.50 for a paid tier.</small>
            </label>
            <label className="tier-enabled">
              <input
                type="checkbox"
                checked={tier.enabled}
                onChange={(event) =>
                  update(index, { enabled: event.target.checked })
                }
              />
              Available to callers
            </label>
            <div className="tier-editor-actions">
              <button
                className="button secondary"
                type="button"
                aria-label={`Move ${tier.name || "tier"} up`}
                onClick={() => move(index, -1)}
                disabled={index === 0}
              >
                ↑
              </button>
              <button
                className="button secondary"
                type="button"
                aria-label={`Move ${tier.name || "tier"} down`}
                onClick={() => move(index, 1)}
                disabled={index === tiers.length - 1}
              >
                ↓
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setTiers((current) => current.filter((_, i) => i !== index));
                  setDirty(true);
                }}
                disabled={tiers.length === 1}
              >
                Remove
              </button>
            </div>
          </fieldset>
        ))}
      </div>
      {tiers.length < 5 && (
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            setTiers((current) => [
              ...current,
              {
                key: crypto.randomUUID(),
                name: `Tier ${current.length + 1}`,
                callDurationSeconds: 300,
                priceCents: 0,
                enabled: true,
              },
            ]);
            setDirty(true);
          }}
        >
          Add tier
        </button>
      )}
      <div className="tier-config-footer">
        <button
          className="button secondary"
          type="button"
          onClick={() => void saveChanges()}
          disabled={!dirty || save.isPending}
        >
          {save.isPending ? "Saving…" : dirty ? "Save tiers" : "Tiers saved"}
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={onStart}
          disabled={
            dirty ||
            starting ||
            tiers.length === 0 ||
            (hasEnabledPaidTier && !payoutsReady)
          }
          aria-describedby={
            hasEnabledPaidTier && !payoutsReady ? "payouts-required" : undefined
          }
        >
          {starting ? "Starting…" : "Start Hotline"}
        </button>
      </div>
      {hasEnabledPaidTier && !payoutsReady && (
        <p className="tier-save-hint" id="payouts-required">
          Finish Stripe payout setup before starting with paid tiers.
        </p>
      )}
      {dirty && (
        <p className="tier-save-hint">Save tier changes before going live.</p>
      )}
      {save.isError && (
        <div className="form-error" role="alert">
          {save.error.message}
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const username = me.data?.username ?? "";
  const currentShow = useCurrentShow();
  const createShow = useCreateShow();
  const startShow = useStartShow(username);
  const endShow = useEndShow(username);
  const payouts = usePayoutStatus();
  const payoutOnboarding = usePayoutOnboarding();
  const paymentActivity = usePaymentActivity();
  const activeShow = currentShow.data;

  async function signOut() {
    try {
      await logout.mutateAsync();
      navigate("/login", { replace: true });
    } catch {
      // The inline status below keeps the creator in a recoverable state.
    }
  }

  return (
    <div className="studio-shell">
      <a className="skip-link" href="#studio-main">
        Skip to studio
      </a>
      <header className="studio-header">
        <div className="studio-brand">
          <Brand />
          <span>CREATOR STUDIO</span>
        </div>
        <div className="studio-header-actions">
          <Link className="text-button" to="/">
            Explore Bling <UiIcon name="arrow" size={15} />
          </Link>
          <span className="account-avatar">
            {username.slice(0, 2).toUpperCase()}
          </span>
        </div>
      </header>
      <div className="studio-layout">
        <aside className="studio-sidebar" aria-label="Creator navigation">
          <div>
            <p className="nav-label">Your workspace</p>
            <a className="active" href="#studio-main">
              <UiIcon name="home" />
              Overview
            </a>
            <a href="#hotline-controls">
              <UiIcon name="broadcast" />
              Stream manager
            </a>
            <a href="#payment-activity">
              <UiIcon name="wallet" />
              Payment activity
            </a>
            <a href="#payouts">
              <UiIcon name="settings" />
              Payout settings
            </a>
            <div className="sidebar-rule" />
            <p className="nav-label">Your channel</p>
            <Link to={`/u/${username}`}>
              <UiIcon name="people" />
              View public page <UiIcon name="arrow" size={14} />
            </Link>
            <a href="#profile">
              <UiIcon name="people" />
              Public profile
            </a>
            <a href="#account">
              <UiIcon name="settings" />
              Account details
            </a>
          </div>
          <div className="studio-sidebar-bottom">
            <div className="studio-tip">
              <UiIcon name="spark" />
              <strong>
                A good show starts
                <br />
                with a conversation.
              </strong>
              <p>Share your link. Open the line. Make someone’s day.</p>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={signOut}
              disabled={logout.isPending}
            >
              <UiIcon name="logout" size={18} />
              {logout.isPending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </aside>
        <main id="studio-main" className="dashboard-content">
          <div className="studio-title">
            <div>
              <p className="eyebrow">Your channel, at a glance</p>
              <h1>Welcome, {username}.</h1>
              <p className="lede">
                A little preparation. A great conversation. Let’s make it
                happen.
              </p>
            </div>
            <Link className="button secondary" to={`/u/${username}`}>
              View channel <UiIcon name="arrow" size={16} />
            </Link>
          </div>
          <div className="studio-overview" aria-label="Channel overview">
            <article>
              <span>
                <UiIcon name="broadcast" size={18} />
                Hotline status
              </span>
              <strong>
                {currentShow.isPending
                  ? "Loading…"
                  : currentShow.isError
                    ? "Unavailable"
                    : activeShow?.status === "LIVE"
                      ? "On air"
                      : activeShow?.status === "CREATED"
                        ? "In preparation"
                        : "Offline"}
              </strong>
              <small>
                {activeShow?.status === "LIVE"
                  ? "Your audience can join the line"
                  : "Your next conversation starts here"}
              </small>
              <span
                className={`metric-indicator ${activeShow?.status === "LIVE" ? "on-air" : ""}`}
              />
            </article>
            <article>
              <span>
                <UiIcon name="wallet" size={18} />
                Payout account
              </span>
              <strong>
                {payouts.isPending
                  ? "Loading…"
                  : payouts.isError
                    ? "Unavailable"
                    : payouts.data.ready
                      ? "Connected"
                      : "Set up payouts"}
              </strong>
              <small>
                {payouts.data
                  ? `${100 - payouts.data.platformFeePercent}% creator share per paid call`
                  : "Connect Stripe to receive earnings"}
              </small>
            </article>
            <article>
              <span>
                <UiIcon name="people" size={18} />
                Grow your community
              </span>
              <strong>Make it personal.</strong>
              <small>Invite your audience to your public page</small>
              <UiIcon name="spark" size={34} />
            </article>
          </div>
          <div className="studio-panels">
            <section
              id="hotline-controls"
              className="show-card controls-card"
              aria-label="Hotline controls"
            >
              <div className="panel-heading">
                <span>
                  <UiIcon name="broadcast" size={18} />
                  Stream manager
                </span>
                <span className="panel-label">LIVE CONTROL ROOM</span>
              </div>
              {currentShow.isPending ? (
                <div className="status">Loading show status…</div>
              ) : currentShow.isError ? (
                <div className="form-error" role="alert">
                  Unable to load your Hotline status.
                </div>
              ) : activeShow?.status === "LIVE" ? (
                <>
                  <div className="show-card-heading">
                    <div>
                      <div className="live-badge">
                        <span /> Hotline live
                      </div>
                      <h2>Your audience can join.</h2>
                    </div>
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => endShow.mutate(activeShow.id)}
                      disabled={endShow.isPending}
                    >
                      {endShow.isPending ? "Ending…" : "End Hotline"}
                    </button>
                  </div>
                  <p>
                    Public URL: <strong>/u/{username}</strong>
                  </p>
                  <CallerList showID={activeShow.id} />
                </>
              ) : activeShow?.status === "CREATED" ? (
                <TierConfiguration
                  showID={activeShow.id}
                  starting={startShow.isPending}
                  payoutsReady={payouts.data?.ready ?? false}
                  onStart={() => startShow.mutate(activeShow.id)}
                />
              ) : (
                <div className="studio-offline">
                  <div className="studio-offline-art" aria-hidden="true">
                    <span className="studio-ring ring-one" />
                    <span className="studio-ring ring-two" />
                    <span className="studio-mic">
                      <UiIcon name="call" size={36} />
                    </span>
                    <span className="offline-art-label">
                      YOUR NEXT GREAT CONVERSATION
                    </span>
                  </div>
                  <span className="offline-pill">OFF AIR</span>
                  <h2>No active Hotline</h2>
                  <p>
                    Create a draft to configure caller priority, duration, and
                    pricing before opening your public page.
                  </p>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => createShow.mutate()}
                    disabled={createShow.isPending}
                  >
                    <UiIcon name="plus" size={17} />
                    {createShow.isPending ? "Creating…" : "Set up Hotline"}
                  </button>
                </div>
              )}
              {(createShow.isError || startShow.isError || endShow.isError) && (
                <div className="form-error" role="alert">
                  Unable to update your Hotline. Please try again.
                </div>
              )}
            </section>

            <section
              id="payouts"
              className="show-card payout-card"
              aria-label="Creator payouts"
            >
              <p className="eyebrow">Creator payouts</p>
              {payouts.isPending ? (
                <div className="status">Checking Stripe payout status…</div>
              ) : payouts.isError ? (
                <div className="form-error" role="alert">
                  Unable to load payout status.
                </div>
              ) : payouts.data.ready ? (
                <>
                  <h2>Stripe payouts are ready.</h2>
                  <p>
                    You receive {100 - payouts.data.platformFeePercent}% of each
                    paid call. Bling’s platform fee is{" "}
                    {payouts.data.platformFeePercent}%.
                  </p>
                </>
              ) : (
                <>
                  <h2>
                    {payouts.data.connected
                      ? "Finish Stripe payout setup"
                      : "Connect Stripe to accept paid calls"}
                  </h2>
                  <p>
                    Set your own price for each tier. You receive{" "}
                    {100 - payouts.data.platformFeePercent}% of every paid call
                    and Bling keeps {payouts.data.platformFeePercent}%.
                  </p>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => payoutOnboarding.mutate()}
                    disabled={payoutOnboarding.isPending}
                  >
                    {payoutOnboarding.isPending
                      ? "Opening Stripe…"
                      : payouts.data.connected
                        ? "Continue Stripe setup"
                        : "Set up payouts"}
                  </button>
                  {payoutOnboarding.isError && (
                    <div className="form-error" role="alert">
                      {payoutOnboarding.error.message}
                    </div>
                  )}
                </>
              )}
            </section>

            {paymentActivity.data?.payoutFailure && (
              <section
                className="show-card payout-problem"
                aria-label="Payout problem"
              >
                <p className="eyebrow">Payout needs attention</p>
                <h2>Stripe could not send your latest payout.</h2>
                <p role="alert">
                  Update your payout details in Stripe before another bank
                  transfer can be sent. Reference:{" "}
                  {paymentActivity.data.payoutFailure.failureCode}
                </p>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => payoutOnboarding.mutate()}
                  disabled={payoutOnboarding.isPending}
                >
                  Update payout details
                </button>
              </section>
            )}

            <section
              id="payment-activity"
              className="show-card activity-card"
              aria-label="Payment activity"
            >
              <p className="eyebrow">Payment activity</p>
              <h2>Recent paid calls</h2>
              {paymentActivity.isPending ? (
                <div className="status">Loading payment activity…</div>
              ) : paymentActivity.isError ? (
                <div className="form-error" role="alert">
                  Unable to load payment activity.
                </div>
              ) : paymentActivity.data.activity.length === 0 ? (
                <div className="payment-empty">
                  <span className="feature-icon">
                    <UiIcon name="wallet" size={22} />
                  </span>
                  <h3>No paid calls yet.</h3>
                  <p>
                    Your paid call activity will appear here after your first
                    conversation.
                  </p>
                </div>
              ) : (
                <ol className="payment-activity-list">
                  {paymentActivity.data.activity.map((activity) => (
                    <li key={activity.paymentAttemptId}>
                      <div>
                        <strong>{formatPrice(activity.amountCents)}</strong>
                        <span>{activityLabel(activity)}</span>
                      </div>
                      <span>
                        Creator share:{" "}
                        {formatPrice(
                          activity.amountCents - activity.platformFeeCents,
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
          <ProfileEditor />
          <div id="account" className="account-card">
            <span>Public URL</span>
            <strong>/u/{username}</strong>
            <span>Account email</span>
            <strong>{me.data?.email}</strong>
          </div>
          {logout.isError && (
            <div className="form-error" role="alert">
              Unable to sign out. Please try again.
            </div>
          )}
          <footer className="studio-footer">
            <span>
              <UiIcon name="call" size={14} />
              Your voice. Your community.
            </span>
            <Link to="/">
              Back to Bling <UiIcon name="arrow" size={14} />
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
