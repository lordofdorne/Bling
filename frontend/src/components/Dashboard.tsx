import { useMemo, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useLogout, useMe } from "../lib/auth";
import {
  useActiveCall,
  useSelectCaller,
  useSelectRandomCaller,
} from "../lib/calls";
import { useCreatorQueue, useQueueEvents } from "../lib/queue";
import {
  useCreatorBalance,
  usePayoutAccountSession,
  usePayoutStatus,
} from "../lib/payouts";
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
import { PayoutSetup } from "./PayoutSetup";
import { ThemeSwitch } from "./ThemeSwitch";
import {
  PaymentMethodSetup,
  usePaymentMethods,
  usePaymentMethodSetup,
  useRefreshPaymentMethods,
  useRemovePaymentMethod,
} from "../lib/payments";

function CallerList({ showID }: { showID: string }) {
  const queue = useCreatorQueue(showID);
  const activeCall = useActiveCall(showID);
  const selectCaller = useSelectCaller(showID);
  const selectRandom = useSelectRandomCaller(showID);
  const [search, setSearch] = useState("");
  useQueueEvents(showID, "creator", true);
  const entries = useMemo(() => queue.data ?? [], [queue.data]);
  const sortedEntries = useMemo(
    () =>
      [...entries].sort(
        (left, right) =>
          right.priorityRank - left.priorityRank ||
          left.joinedAt.localeCompare(right.joinedAt),
      ),
    [entries],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleEntries = useMemo(
    () =>
      normalizedSearch
        ? sortedEntries.filter((entry) =>
            [entry.displayName, entry.topic, entry.tierName].some((value) =>
              value.toLocaleLowerCase().includes(normalizedSearch),
            ),
          )
        : sortedEntries,
    [normalizedSearch, sortedEntries],
  );
  if (queue.isPending || activeCall.isPending)
    return <div className="status">Loading caller queue…</div>;
  if (queue.isError || activeCall.isError)
    return (
      <div className="form-error" role="alert">
        Unable to load the caller queue.
      </div>
    );
  const call = activeCall.data;
  return (
    <section className="caller-list" aria-label="Caller requests">
      <div className="caller-list-heading">
        <div>
          <h2>Caller requests</h2>
          <span>{entries.length} waiting</span>
        </div>
        {!call && entries.length > 0 && (
          <button
            className="button secondary"
            type="button"
            onClick={() => selectRandom.mutate(undefined)}
            disabled={selectRandom.isPending}
          >
            {selectRandom.isPending ? "Choosing…" : "Pick a random caller"}
          </button>
        )}
      </div>
      {call && (
        <div className="active-call-card" aria-label="Active call">
          <p className="eyebrow">{call.status.replace("_", " ")}</p>
          <strong>{call.caller.displayName}</strong>
          <p>{call.caller.topic}</p>
          <span>
            {call.caller.tierName} ·{" "}
            {formatCallLength(call.callDurationSeconds)} reserved
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
        <>
          <div className="caller-list-toolbar">
            <label className="caller-search">
              <span className="sr-only">Search caller requests</span>
              <UiIcon name="search" size={17} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, topic, or tier"
                autoComplete="off"
              />
            </label>
            <span className="caller-result-count" aria-live="polite">
              {visibleEntries.length === entries.length
                ? `${entries.length} requests`
                : `${visibleEntries.length} of ${entries.length}`}
            </span>
          </div>
          {visibleEntries.length === 0 ? (
            <div className="caller-search-empty">
              <UiIcon name="search" size={20} />
              <strong>No matching callers</strong>
              <span>Try another name, topic, or tier.</span>
            </div>
          ) : (
            <ol className="caller-request-list">
              {visibleEntries.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{entry.displayName}</strong>
                    <span>
                      {entry.tierName} ·{" "}
                      {formatCallLength(entry.callDurationSeconds)} ·{" "}
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
        </>
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

function formatCallLength(seconds: number) {
  const minutes = seconds / 60;
  return `${Number(minutes.toFixed(2))} ${minutes === 1 ? "minute" : "minutes"}`;
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
> & { key: string; durationInput: string; priceInput: string; paid: boolean };

const MINIMUM_PAID_TIER_CENTS = 50;
const DEFAULT_PAID_TIER_CENTS = 500;

function durationInputFromSeconds(seconds: number) {
  return Number((seconds / 60).toFixed(2)).toString();
}

function priceInputFromCents(cents: number) {
  return (cents / 100).toFixed(2);
}

function centsFromPriceInput(value: string) {
  if (!/^\d*(?:\.\d{0,2})?$/.test(value)) return null;
  if (value === "" || value === ".") return 0;
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars > 10_000) return null;
  return Math.round(dollars * 100);
}

function estimatedCreatorEarningsCents(amountCents: number) {
  const basicCardFeeCents = Math.round(amountCents * 0.029) + 30;
  const creatorCardFeeCents = Math.floor(basicCardFeeCents / 2);
  return Math.max(0, Math.floor(amountCents * 0.8) - creatorCardFeeCents);
}

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
  const payouts = usePayoutStatus();
  // Only a confirmed ready account unlocks paid tiers. A pending or failed
  // status is not permission to charge callers.
  const payoutsReady = payouts.data?.ready === true;
  const [tiers, setTiers] = useState<TierDraft[]>(() =>
    initialTiers.map((tier) => ({
      key: tier.id,
      name: tier.name,
      callDurationSeconds: tier.callDurationSeconds,
      durationInput: durationInputFromSeconds(tier.callDurationSeconds),
      priceCents: tier.priceCents,
      priceInput: priceInputFromCents(tier.priceCents),
      paid: tier.priceCents > 0,
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

  const paidBelowMinimum = tiers.some(
    (tier) => tier.paid && tier.priceCents < MINIMUM_PAID_TIER_CENTS,
  );
  const paidWithoutPayouts =
    !payoutsReady && tiers.some((tier) => tier.enabled && tier.priceCents > 0);

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
      {!payouts.isPending && !payoutsReady && (
        <div className="tier-payout-notice">
          <span className="feature-icon">
            <UiIcon name="wallet" size={20} />
          </span>
          <div>
            <strong>Set up payouts to charge for calls.</strong>
            <p>
              Bling can only take a caller’s money once it can pass your share
              on to you. Free tiers work today.
            </p>
          </div>
          <Link
            className="button secondary compact"
            to="/dashboard/settings/payouts"
          >
            Set up payouts
          </Link>
        </div>
      )}
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
              Call length (minutes)
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-label={`${tier.name || `Tier ${index + 1}`} call length in minutes`}
                value={tier.durationInput}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!/^\d*(?:\.\d{0,2})?$/.test(value)) return;
                  const minutes = Number(value);
                  if (
                    value !== "" &&
                    (!Number.isFinite(minutes) || minutes > 60)
                  ) {
                    return;
                  }
                  update(index, {
                    durationInput: value,
                    ...(minutes > 0
                      ? { callDurationSeconds: Math.round(minutes * 60) }
                      : {}),
                  });
                }}
                onBlur={() => {
                  const minutes = Number(tier.durationInput);
                  const seconds =
                    !Number.isFinite(minutes) || minutes < 0.5
                      ? 30
                      : Math.min(3600, Math.round(minutes * 60));
                  const normalized = durationInputFromSeconds(seconds);
                  if (
                    seconds !== tier.callDurationSeconds ||
                    normalized !== tier.durationInput
                  ) {
                    update(index, {
                      callDurationSeconds: seconds,
                      durationInput: normalized,
                    });
                  }
                }}
              />
              <small>Choose between 0.5 and 60 minutes.</small>
            </label>
            <label>
              Pricing
              <select
                aria-label={`${tier.name || `Tier ${index + 1}`} pricing`}
                value={tier.paid ? "paid" : "free"}
                onChange={(event) => {
                  if (event.target.value === "paid") {
                    const priceCents =
                      tier.priceCents > 0
                        ? tier.priceCents
                        : DEFAULT_PAID_TIER_CENTS;
                    update(index, {
                      paid: true,
                      priceCents,
                      priceInput: priceInputFromCents(priceCents),
                    });
                    return;
                  }
                  update(index, {
                    paid: false,
                    priceCents: 0,
                    priceInput: priceInputFromCents(0),
                  });
                }}
              >
                <option value="free">Free</option>
                {/* Charging callers is only possible once Bling can pay the
                    creator, so the option stays disabled until payouts are
                    ready. */}
                <option value="paid" disabled={!payoutsReady}>
                  {payoutsReady ? "Paid" : "Paid (set up payouts first)"}
                </option>
              </select>
              <small>
                {tier.paid
                  ? "Callers authorize this card charge before they join."
                  : "Free callers join without a card."}
              </small>
            </label>
            {tier.paid && (
              <label>
                Price (USD)
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`${tier.name || `Tier ${index + 1}`} price in USD`}
                  value={tier.priceInput}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    const priceCents = centsFromPriceInput(event.target.value);
                    if (priceCents === null) return;
                    update(index, {
                      priceInput: event.target.value,
                      priceCents,
                    });
                  }}
                  onBlur={() => {
                    const normalized = priceInputFromCents(tier.priceCents);
                    if (normalized !== tier.priceInput) {
                      update(index, { priceInput: normalized });
                    }
                  }}
                />
                <small>
                  {tier.priceCents >= MINIMUM_PAID_TIER_CENTS
                    ? `Estimated payout: ${formatPrice(estimatedCreatorEarningsCents(tier.priceCents))}`
                    : "Charge at least $0.50 for a paid tier."}
                </small>
              </label>
            )}
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
                durationInput: "5",
                priceCents: 0,
                priceInput: priceInputFromCents(0),
                paid: false,
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
          disabled={!dirty || paidBelowMinimum || save.isPending}
        >
          {save.isPending ? "Saving…" : dirty ? "Save tiers" : "Tiers saved"}
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={onStart}
          disabled={
            dirty || starting || tiers.length === 0 || paidWithoutPayouts
          }
        >
          {starting ? "Starting…" : "Start Hotline"}
        </button>
      </div>

      {paidBelowMinimum ? (
        <p className="tier-save-hint">
          A paid tier must charge at least $0.50.
        </p>
      ) : paidWithoutPayouts ? (
        <p className="tier-save-hint">
          Finish payout setup, or price these tiers as free, before going live.
        </p>
      ) : (
        dirty && (
          <p className="tier-save-hint">Save tier changes before going live.</p>
        )
      )}
      {save.isError && (
        <div className="form-error" role="alert">
          {save.error.message}
        </div>
      )}
    </div>
  );
}

type SettingsSection = "profile" | "payments" | "payouts" | "account";

function CreatorPayoutSettings() {
  const payouts = usePayoutStatus();
  const payoutSession = usePayoutAccountSession();
  const creatorBalance = useCreatorBalance();
  const paymentActivity = usePaymentActivity();

  return (
    <section
      className="show-card payout-card settings-section-card"
      aria-label="Creator payouts"
    >
      <div className="settings-section-heading">
        <span className="feature-icon">
          <UiIcon name="wallet" size={21} />
        </span>
        <div>
          <h2>Payouts</h2>
          <p>Review your balance and manage where your monthly payout goes.</p>
        </div>
      </div>
      {creatorBalance.data && (
        <div className="balance-summary" aria-label="Creator balance">
          <div>
            <span>Available</span>
            <strong>
              {formatPrice(creatorBalance.data.balance.availableCents)}
            </strong>
          </div>
          <div>
            <span>Pending</span>
            <strong>
              {formatPrice(creatorBalance.data.balance.pendingCents)}
            </strong>
          </div>
          <div>
            <span>Total balance</span>
            <strong>
              {formatPrice(creatorBalance.data.balance.totalCents)}
            </strong>
          </div>
        </div>
      )}
      {paymentActivity.data?.payoutFailure && (
        <div className="settings-alert" role="alert">
          <strong>Your latest payout needs attention.</strong>
          <span>
            Update your payout details before another bank transfer can be sent.
            Reference: {paymentActivity.data.payoutFailure.failureCode}
          </span>
        </div>
      )}
      <div className="settings-divider" />
      {payouts.isPending ? (
        <div className="status">Checking payout status…</div>
      ) : payouts.isError ? (
        <div className="form-error" role="alert">
          Unable to load payout status.
        </div>
      ) : payoutSession.data ? (
        <PayoutSetup
          session={payoutSession.data}
          onExit={() => {
            payoutSession.reset();
            void payouts.refetch();
          }}
        />
      ) : payouts.data.ready ? (
        <div className="payout-ready-row">
          <span className="feature-icon success">
            <UiIcon name="check" size={20} />
          </span>
          <div>
            <h3>Your payouts are ready.</h3>
            <p>
              You receive {100 - payouts.data.platformFeePercent}% of each paid
              call, less half of the basic card fee (2.9% + $0.30). Bling pays
              the other half. Available balances are sent monthly.
            </p>
            {payouts.data.externalAccountPresent && (
              <div className="payout-bank-summary">
                <strong>
                  {payouts.data.externalAccountBankName || "Bank account"}
                </strong>
                <span>
                  •••• {payouts.data.externalAccountLast4}
                  {payouts.data.externalAccountCurrency
                    ? ` · ${payouts.data.externalAccountCurrency.toUpperCase()}`
                    : ""}
                </span>
              </div>
            )}
            <button
              className="button secondary compact"
              type="button"
              onClick={() => payoutSession.mutate()}
              disabled={payoutSession.isPending}
            >
              {payoutSession.isPending
                ? "Opening secure setup…"
                : "Update bank account"}
            </button>
          </div>
        </div>
      ) : (
        <div className="payout-setup-copy">
          <div>
            <h3>
              {payouts.data.connected
                ? payouts.data.transfersStatus === "active"
                  ? "Add your bank account"
                  : "Finish your payout setup"
                : "Set up monthly payouts"}
            </h3>
            <p>
              Paid tiers stay locked until this is done. Securely add your
              identity and bank details to charge for calls. You receive{" "}
              {100 - payouts.data.platformFeePercent}% of every paid call, less
              half of the basic card fee (2.9% + $0.30). Bling pays the other
              half.
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => payoutSession.mutate()}
            disabled={payoutSession.isPending}
          >
            {payoutSession.isPending
              ? "Opening secure setup…"
              : payouts.data.connected
                ? payouts.data.transfersStatus === "active"
                  ? "Add bank account"
                  : "Continue payout setup"
                : "Set up payouts"}
          </button>
          {payoutSession.isError && (
            <div className="form-error" role="alert">
              {payoutSession.error.message}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SavePaymentMethodForm({
  onSaved,
  onCancel,
}: {
  onSaved: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError("");
    const result = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url: window.location.href,
        payment_method_data: { allow_redisplay: "always" },
      },
    });
    if (result.error) {
      setError(result.error.message ?? "Unable to save this payment method.");
      setSubmitting(false);
      return;
    }
    if (result.setupIntent?.status !== "succeeded") {
      setError("Payment setup is still incomplete. Try again.");
      setSubmitting(false);
      return;
    }
    onSaved();
  }

  return (
    <div className="saved-payment-form">
      <PaymentElement options={{ layout: "tabs" }} />
      <p className="field-hint">
        Stripe securely stores your payment details. Bling never receives your
        full card number or CVC.
      </p>
      <div className="saved-payment-actions">
        <button
          className="primary-button"
          type="button"
          onClick={save}
          disabled={!stripe || submitting}
        >
          {submitting ? "Saving…" : "Save payment method"}
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function PaymentMethodSetupPanel({
  setup,
  onSaved,
  onCancel,
}: {
  setup: PaymentMethodSetup;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const stripePromise = useMemo(
    () => loadStripe(setup.publishableKey),
    [setup.publishableKey],
  );
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: setup.clientSecret,
        customerSessionClientSecret: setup.customerSessionClientSecret,
        appearance: { theme: "stripe" },
      }}
    >
      <SavePaymentMethodForm onSaved={onSaved} onCancel={onCancel} />
    </Elements>
  );
}

function UserPaymentSettings() {
  const methods = usePaymentMethods();
  const setup = usePaymentMethodSetup();
  const remove = useRemovePaymentMethod();
  const refresh = useRefreshPaymentMethods();

  async function saved() {
    setup.reset();
    await refresh();
  }

  return (
    <section
      className="show-card settings-section-card"
      aria-label="Saved payments"
    >
      <div className="settings-section-heading">
        <span className="feature-icon">
          <UiIcon name="wallet" size={21} />
        </span>
        <div>
          <h2>Payment methods</h2>
          <p>Save a card for faster call requests and manage it here.</p>
        </div>
      </div>

      {setup.data ? (
        <PaymentMethodSetupPanel
          setup={setup.data}
          onSaved={() => void saved()}
          onCancel={() => setup.reset()}
        />
      ) : (
        <>
          {methods.isPending ? (
            <div className="status">Loading saved payment methods…</div>
          ) : methods.isError ? (
            <div className="form-error" role="alert">
              Unable to load saved payment methods.
            </div>
          ) : methods.data.length === 0 ? (
            <div className="saved-payment-empty">
              <span className="feature-icon">
                <UiIcon name="wallet" size={20} />
              </span>
              <div>
                <h3>No saved payment methods</h3>
                <p>Add a card now or save one during your next paid call.</p>
              </div>
            </div>
          ) : (
            <div className="saved-payment-list">
              {methods.data.map((method) => (
                <div className="saved-payment-row" key={method.id}>
                  <span className="payment-brand">
                    {method.brand.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>
                      {method.brand.replaceAll("_", " ")} •••• {method.last4}
                    </strong>
                    <span>
                      Expires {String(method.expMonth).padStart(2, "0")}/
                      {String(method.expYear).slice(-2)}
                    </span>
                  </div>
                  <button
                    className="button secondary compact"
                    type="button"
                    onClick={() => remove.mutate(method.id)}
                    disabled={remove.isPending}
                    aria-label={`Remove ${method.brand} ending in ${method.last4}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            className="primary-button saved-payment-add"
            type="button"
            onClick={() => setup.mutate()}
            disabled={setup.isPending}
          >
            {setup.isPending ? "Opening secure form…" : "Add payment method"}
          </button>
          {(setup.isError || remove.isError) && (
            <div className="form-error" role="alert">
              {setup.error?.message ?? remove.error?.message}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CreatorAccountSettings({ username }: { username: string }) {
  const me = useMe();
  return (
    <>
      <section
        className="show-card settings-section-card"
        aria-label="Appearance"
      >
        <div className="settings-section-heading">
          <span className="feature-icon">
            <UiIcon name="spark" size={21} />
          </span>
          <div>
            <h2>Appearance</h2>
            <p>Switch between dark, light, or your device setting.</p>
          </div>
        </div>
        <ThemeSwitch />
      </section>
      <section className="show-card settings-section-card" aria-label="Account">
        <div className="settings-section-heading">
          <span className="feature-icon">
            <UiIcon name="settings" size={21} />
          </span>
          <div>
            <h2>Account</h2>
            <p>Your sign-in details and permanent channel address.</p>
          </div>
        </div>
        <dl className="account-settings-list">
          <div>
            <dt>Username</dt>
            <dd>@{username}</dd>
          </div>
          <div>
            <dt>Email address</dt>
            <dd>{me.data?.email}</dd>
          </div>
          <div>
            <dt>Public channel</dt>
            <dd>
              <Link to={`/u/${username}`}>/u/{username}</Link>
            </dd>
          </div>
        </dl>
      </section>
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
    <div className="settings-page">
      <header className="settings-title">
        <p className="eyebrow">Creator studio</p>
        <h1>Settings</h1>
        <p>Manage your public presence, appearance, payouts, and account.</p>
      </header>
      <nav className="settings-tabs" aria-label="Settings sections">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            to={`/dashboard/settings/${tab.id}`}
            className={section === tab.id ? "active" : undefined}
            aria-current={section === tab.id ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="settings-panel">
        {section === "profile" && <ProfileEditor />}
        {section === "payments" && <UserPaymentSettings />}
        {section === "payouts" && <CreatorPayoutSettings />}
        {section === "account" && (
          <CreatorAccountSettings username={username} />
        )}
      </div>
    </div>
  );
}

export function Dashboard() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const username = me.data?.username ?? "";
  const currentShow = useCurrentShow();
  const createShow = useCreateShow();
  const startShow = useStartShow(username);
  const endShow = useEndShow(username);
  const payouts = usePayoutStatus();
  const paymentActivity = usePaymentActivity();
  const activeShow = currentShow.data;
  const settingsMatch = location.pathname.match(
    /^\/dashboard\/settings(?:\/(profile|payments|payouts|account))?\/?$/,
  );
  const isSettings = Boolean(settingsMatch);
  const settingsSection = (settingsMatch?.[1] ?? "profile") as SettingsSection;

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
            <Link
              className={!isSettings ? "active" : undefined}
              to="/dashboard"
            >
              <UiIcon name="home" />
              Overview
            </Link>
            <Link to="/dashboard#hotline-controls">
              <UiIcon name="broadcast" />
              Stream manager
            </Link>
            <Link to="/dashboard#payment-activity">
              <UiIcon name="wallet" />
              Payment activity
            </Link>
            <Link
              className={
                isSettings && settingsSection === "payouts"
                  ? "active"
                  : undefined
              }
              to="/dashboard/settings/payouts"
            >
              <UiIcon name="settings" />
              Payout settings
            </Link>
            <Link
              className={
                isSettings && settingsSection === "payments"
                  ? "active"
                  : undefined
              }
              to="/dashboard/settings/payments"
            >
              <UiIcon name="wallet" />
              Saved payments
            </Link>
            <div className="sidebar-rule" />
            <p className="nav-label">Your channel</p>
            <Link to={`/u/${username}`}>
              <UiIcon name="people" />
              View public page <UiIcon name="arrow" size={14} />
            </Link>
            <Link
              className={
                isSettings && settingsSection === "profile"
                  ? "active"
                  : undefined
              }
              to="/dashboard/settings/profile"
            >
              <UiIcon name="people" />
              Public profile
            </Link>
            <Link
              className={
                isSettings && settingsSection === "account"
                  ? "active"
                  : undefined
              }
              to="/dashboard/settings/account"
            >
              <UiIcon name="settings" />
              Account details
            </Link>
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
          {isSettings ? (
            <CreatorSettings section={settingsSection} username={username} />
          ) : (
            <>
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
                      ? `${100 - payouts.data.platformFeePercent}% creator share, less half the basic card fee`
                      : "Set up payouts to charge for calls"}
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
                        Create a draft to configure caller priority, duration,
                        and pricing before opening your public page.
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
                  {(createShow.isError ||
                    startShow.isError ||
                    endShow.isError) && (
                    <div className="form-error" role="alert">
                      {startShow.error instanceof ApiError &&
                      startShow.error.code === "PAYOUT_SETUP_REQUIRED"
                        ? startShow.error.message
                        : "Unable to update your Hotline. Please try again."}
                    </div>
                  )}
                </section>

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
                        Your paid call activity will appear here after your
                        first conversation.
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
                            {activity.creatorProcessingFeeCents > 0
                              ? ` · includes your ${formatPrice(activity.creatorProcessingFeeCents)} half of the card fee`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            </>
          )}
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
