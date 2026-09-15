import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Plus, Trash2, Wallet } from "lucide-react";
import { usePayoutStatus } from "../../lib/payouts";
import {
  HotlineTier,
  useSaveTierConfiguration,
  useTierConfiguration,
} from "../../lib/shows";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_PAID_TIER_CENTS,
  MINIMUM_PAID_TIER_CENTS,
  centsFromPriceInput,
  durationInputFromSeconds,
  estimatedCreatorEarningsCents,
  formatPrice,
  priceInputFromCents,
} from "./format";

type TierDraft = Pick<
  HotlineTier,
  "name" | "callDurationSeconds" | "priceCents" | "enabled"
> & { key: string; durationInput: string; priceInput: string; paid: boolean };

export function TierConfiguration({
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
    return (
      <p className="text-muted-foreground text-sm">Loading Hotline tiers…</p>
    );
  if (configuration.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Unable to load the tier configuration.
        </AlertDescription>
      </Alert>
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
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-bold">Configure caller tiers</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Higher rows are selected first. Paid tiers authorize cards at queue
          entry and capture only when you select a caller.
        </p>
      </div>

      {!payouts.isPending && !payoutsReady && (
        <div className="bg-muted flex flex-wrap items-center gap-4 rounded-xl p-4">
          <span className="bg-background text-primary grid size-10 shrink-0 place-items-center rounded-lg">
            <Wallet className="size-5" />
          </span>
          <div className="min-w-[220px] flex-1">
            <strong className="text-sm">
              Set up payouts to charge for calls.
            </strong>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Bling can only take a caller’s money once it can pass your share
              on to you. Free tiers work today.
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link to="/dashboard/settings/payouts">Set up payouts</Link>
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {tiers.map((tier, index) => (
          <fieldset
            className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2"
            key={tier.key}
          >
            <legend className="text-[var(--sand-text)] px-2 text-[11px] font-bold tracking-[0.1em] uppercase">
              Priority {index + 1}
            </legend>

            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor={`tier-name-${tier.key}`}>Tier name</Label>
              <Input
                id={`tier-name-${tier.key}`}
                value={tier.name}
                maxLength={40}
                onChange={(event) =>
                  update(index, { name: event.target.value })
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`tier-length-${tier.key}`}>
                Call length (minutes)
              </Label>
              <Input
                id={`tier-length-${tier.key}`}
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
              <p className="text-muted-foreground text-xs">
                Choose between 0.5 and 60 minutes.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`tier-pricing-${tier.key}`}>Pricing</Label>
              <Select
                value={tier.paid ? "paid" : "free"}
                onValueChange={(value) => {
                  if (value === "paid") {
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
                <SelectTrigger
                  id={`tier-pricing-${tier.key}`}
                  aria-label={`${tier.name || `Tier ${index + 1}`} pricing`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  {/* Charging callers is only possible once Bling can pay the
                      creator, so the option stays disabled until payouts are
                      ready. */}
                  <SelectItem value="paid" disabled={!payoutsReady}>
                    {payoutsReady ? "Paid" : "Paid (set up payouts first)"}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {tier.paid
                  ? "Callers authorize this card charge before they join."
                  : "Free callers join without a card."}
              </p>
            </div>

            {tier.paid && (
              <div className="grid gap-2">
                <Label htmlFor={`tier-price-${tier.key}`}>Price (USD)</Label>
                <Input
                  id={`tier-price-${tier.key}`}
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
                <p className="text-muted-foreground text-xs">
                  {tier.priceCents >= MINIMUM_PAID_TIER_CENTS
                    ? `Estimated payout: ${formatPrice(estimatedCreatorEarningsCents(tier.priceCents))}`
                    : "Charge at least $0.50 for a paid tier."}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
              <Label className="gap-3" htmlFor={`tier-enabled-${tier.key}`}>
                <Switch
                  id={`tier-enabled-${tier.key}`}
                  checked={tier.enabled}
                  onCheckedChange={(checked) =>
                    update(index, { enabled: checked })
                  }
                />
                Available to callers
              </Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  aria-label={`Move ${tier.name || "tier"} up`}
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  aria-label={`Move ${tier.name || "tier"} down`}
                  onClick={() => move(index, 1)}
                  disabled={index === tiers.length - 1}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setTiers((current) =>
                      current.filter((_, i) => i !== index),
                    );
                    setDirty(true);
                  }}
                  disabled={tiers.length === 1}
                >
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              </div>
            </div>
          </fieldset>
        ))}
      </div>

      {tiers.length < 5 && (
        <Button
          variant="outline"
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
          <Plus className="size-4" />
          Add tier
        </Button>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-5">
        <Button
          variant="secondary"
          type="button"
          onClick={() => void saveChanges()}
          disabled={!dirty || paidBelowMinimum || save.isPending}
        >
          {save.isPending ? "Saving…" : dirty ? "Save tiers" : "Tiers saved"}
        </Button>
        <Button
          type="button"
          onClick={onStart}
          disabled={
            dirty || starting || tiers.length === 0 || paidWithoutPayouts
          }
        >
          {starting ? "Starting…" : "Start Hotline"}
        </Button>
      </div>

      {paidBelowMinimum ? (
        <p className="text-muted-foreground text-right text-sm">
          A paid tier must charge at least $0.50.
        </p>
      ) : paidWithoutPayouts ? (
        <p className="text-muted-foreground text-right text-sm">
          Finish payout setup, or price these tiers as free, before going live.
        </p>
      ) : (
        dirty && (
          <p className="text-muted-foreground text-right text-sm">
            Save tier changes before going live.
          </p>
        )
      )}

      {save.isError && (
        <Alert variant="destructive">
          <AlertDescription>{save.error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
