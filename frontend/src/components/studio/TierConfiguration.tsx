import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Plus, Trash2, Wallet } from "lucide-react";
import { usePayoutStatus } from "../../lib/payouts";
import {
  HotlineTier,
  type HotlineTierInput,
  useSaveTierConfiguration,
  useTierConfiguration,
} from "../../lib/shows";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormError, SwitchField, TextField } from "../form-fields";
import {
  MAX_TIERS,
  tierConfigSchema,
  type TierConfigValues,
  type TierValues,
} from "../../lib/schemas";
import {
  DEFAULT_PAID_TIER_CENTS,
  MINIMUM_PAID_TIER_CENTS,
  centsFromPriceInput,
  durationInputFromSeconds,
  estimatedCreatorEarningsCents,
  formatPrice,
  priceInputFromCents,
} from "./format";

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

function tierValuesFromServer(tier: HotlineTier): TierValues {
  return {
    name: tier.name,
    duration: durationInputFromSeconds(tier.callDurationSeconds),
    paid: tier.priceCents > 0,
    price: priceInputFromCents(tier.priceCents),
    enabled: tier.enabled,
  };
}

function tierInputFromValues(tier: TierValues): HotlineTierInput {
  return {
    name: tier.name,
    callDurationSeconds: Math.round(Number(tier.duration) * 60),
    priceCents: tier.paid ? (centsFromPriceInput(tier.price) ?? 0) : 0,
    enabled: tier.enabled,
  };
}

// Keystroke masks: block characters that can never become a valid value, and
// leave range checks to the schema so the creator sees why.
const DECIMAL_INPUT = /^\d*(?:\.\d{0,2})?$/;

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
  const form = useForm<TierConfigValues>({
    resolver: zodResolver(tierConfigSchema),
    mode: "onTouched",
    defaultValues: { tiers: initialTiers.map(tierValuesFromServer) },
  });
  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name: "tiers",
  });
  const tiers = useWatch({ control: form.control, name: "tiers" });
  const dirty = form.formState.isDirty;
  const paidWithoutPayouts =
    !payoutsReady && tiers.some((tier) => tier.enabled && tier.paid);

  const submit = form.handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync(
        values.tiers.map(tierInputFromValues),
      );
      form.reset({ tiers: saved.map(tierValuesFromServer) });
    } catch {
      // Mutation state renders the server-safe error below.
    }
  });

  return (
    <Form {...form}>
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
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
          {fields.map((field, index) => {
            const tier = tiers[index] ?? field;
            const tierLabel = tier.name || `Tier ${index + 1}`;
            return (
              <fieldset
                className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2"
                key={field.id}
              >
                <legend className="text-[var(--sand-text)] px-2 text-[11px] font-bold tracking-[0.1em] uppercase">
                  Priority {index + 1}
                </legend>

                <TextField
                  control={form.control}
                  name={`tiers.${index}.name`}
                  label="Tier name"
                  className="sm:col-span-2"
                  maxLength={40}
                />

                <FormField
                  control={form.control}
                  name={`tiers.${index}.duration`}
                  render={({ field: input }) => (
                    <FormItem>
                      <FormLabel>Call length (minutes)</FormLabel>
                      <FormControl>
                        <Input
                          {...input}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`${tierLabel} call length in minutes`}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (DECIMAL_INPUT.test(value))
                              input.onChange(value);
                          }}
                          onBlur={() => {
                            const minutes = Number(input.value);
                            if (minutes >= 0.5 && minutes <= 60) {
                              input.onChange(
                                durationInputFromSeconds(
                                  Math.round(minutes * 60),
                                ),
                              );
                            }
                            input.onBlur();
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        Choose between 0.5 and 60 minutes.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name={`tiers.${index}.paid`}
                  render={({ field: input }) => (
                    <FormItem>
                      <FormLabel>Pricing</FormLabel>
                      <Select
                        value={input.value ? "paid" : "free"}
                        onValueChange={(value) => {
                          const paid = value === "paid";
                          input.onChange(paid);
                          const cents = centsFromPriceInput(tier.price) ?? 0;
                          form.setValue(
                            `tiers.${index}.price`,
                            priceInputFromCents(
                              paid ? cents || DEFAULT_PAID_TIER_CENTS : 0,
                            ),
                            { shouldDirty: true },
                          );
                        }}
                      >
                        <FormControl>
                          <SelectTrigger
                            ref={input.ref}
                            onBlur={input.onBlur}
                            aria-label={`${tierLabel} pricing`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="free">Free</SelectItem>
                          {/* Charging callers is only possible once Bling can
                              pay the creator, so the option stays disabled
                              until payouts are ready. */}
                          <SelectItem value="paid" disabled={!payoutsReady}>
                            {payoutsReady
                              ? "Paid"
                              : "Paid (set up payouts first)"}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {input.value
                          ? "Callers authorize this card charge before they join."
                          : "Free callers join without a card."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {tier.paid && (
                  <FormField
                    control={form.control}
                    name={`tiers.${index}.price`}
                    render={({ field: input, fieldState }) => {
                      const cents = centsFromPriceInput(input.value) ?? 0;
                      return (
                        <FormItem>
                          <FormLabel>Price (USD)</FormLabel>
                          <FormControl>
                            <Input
                              {...input}
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              aria-label={`${tierLabel} price in USD`}
                              onFocus={(event) => event.currentTarget.select()}
                              onChange={(event) => {
                                if (
                                  centsFromPriceInput(event.target.value) !==
                                  null
                                ) {
                                  input.onChange(event.target.value);
                                }
                              }}
                              onBlur={() => {
                                input.onChange(priceInputFromCents(cents));
                                input.onBlur();
                              }}
                            />
                          </FormControl>
                          {!fieldState.error && (
                            <FormDescription>
                              {cents >= MINIMUM_PAID_TIER_CENTS
                                ? `Estimated payout: ${formatPrice(estimatedCreatorEarningsCents(cents))}`
                                : "Charge at least $0.50 for a paid tier."}
                            </FormDescription>
                          )}
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
                  <SwitchField
                    control={form.control}
                    name={`tiers.${index}.enabled`}
                    label="Available to callers"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      type="button"
                      aria-label={`Move ${tier.name || "tier"} up`}
                      onClick={() => move(index, index - 1)}
                      disabled={index === 0}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      type="button"
                      aria-label={`Move ${tier.name || "tier"} down`}
                      onClick={() => move(index, index + 1)}
                      disabled={index === fields.length - 1}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => remove(index)}
                      disabled={fields.length === 1}
                    >
                      <Trash2 className="size-4" />
                      Remove
                    </Button>
                  </div>
                </div>
              </fieldset>
            );
          })}
        </div>

        {fields.length < MAX_TIERS && (
          <Button
            variant="outline"
            type="button"
            onClick={() =>
              append({
                name: `Tier ${fields.length + 1}`,
                duration: "5",
                paid: false,
                price: priceInputFromCents(0),
                enabled: true,
              })
            }
          >
            <Plus className="size-4" />
            Add tier
          </Button>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-5">
          <Button
            variant="secondary"
            type="submit"
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? "Saving…" : dirty ? "Save tiers" : "Tiers saved"}
          </Button>
          <Button
            type="button"
            onClick={onStart}
            disabled={
              dirty || starting || fields.length === 0 || paidWithoutPayouts
            }
          >
            {starting ? "Starting…" : "Start Hotline"}
          </Button>
        </div>

        {paidWithoutPayouts ? (
          <p className="text-muted-foreground text-right text-sm">
            Finish payout setup, or price these tiers as free, before going
            live.
          </p>
        ) : (
          dirty && (
            <p className="text-muted-foreground text-right text-sm">
              Save tier changes before going live.
            </p>
          )
        )}

        <FormError
          error={save.error}
          fallback="Unable to save your tiers. Please try again."
        />
      </form>
    </Form>
  );
}
