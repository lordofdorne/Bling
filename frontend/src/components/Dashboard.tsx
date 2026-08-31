import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLogout, useMe } from "../lib/auth";
import {
  useActiveCall,
  useSelectCaller,
  useSelectRandomCaller,
} from "../lib/calls";
import { useCreatorQueue, useQueueEvents } from "../lib/queue";
import {
  HotlineTier,
  useCreateShow,
  useCurrentShow,
  useEndShow,
  useSaveTierConfiguration,
  useStartShow,
  useTierConfiguration,
} from "../lib/shows";
import { CallAudioPanel } from "./CallAudioPanel";

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

type TierDraft = Pick<
  HotlineTier,
  "name" | "callDurationSeconds" | "priceCents" | "enabled"
> & { key: string };

function TierConfiguration({
  showID,
  onStart,
  starting,
}: {
  showID: string;
  onStart: () => void;
  starting: boolean;
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
    />
  );
}

function TierConfigurationForm({
  showID,
  initialTiers,
  onStart,
  starting,
}: {
  showID: string;
  initialTiers: HotlineTier[];
  onStart: () => void;
  starting: boolean;
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
          disabled={dirty || starting || tiers.length === 0}
        >
          {starting ? "Starting…" : "Start Hotline"}
        </button>
      </div>
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
    <main className="page dashboard-page">
      <nav className="nav">
        <Link className="brand" to="/">
          Bling<span>.</span>
        </Link>
        <button
          className="button secondary"
          type="button"
          onClick={signOut}
          disabled={logout.isPending}
        >
          {logout.isPending ? "Signing out…" : "Sign out"}
        </button>
      </nav>
      <section className="dashboard-content">
        <p className="eyebrow">Creator workspace</p>
        <h1>Welcome, {username}.</h1>
        <p className="lede">
          Open your Hotline when you are ready to take live calls from your
          audience.
        </p>

        <section className="show-card" aria-label="Hotline controls">
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
              onStart={() => startShow.mutate(activeShow.id)}
            />
          ) : (
            <>
              <h2>No active Hotline</h2>
              <p>
                Create a draft to configure caller priority, duration, and
                future pricing before opening your public page.
              </p>
              <button
                className="primary-button"
                type="button"
                onClick={() => createShow.mutate()}
                disabled={createShow.isPending}
              >
                {createShow.isPending ? "Creating…" : "Set up Hotline"}
              </button>
            </>
          )}
          {(createShow.isError || startShow.isError || endShow.isError) && (
            <div className="form-error" role="alert">
              Unable to update your Hotline. Please try again.
            </div>
          )}
        </section>

        <div className="account-card">
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
      </section>
    </main>
  );
}
