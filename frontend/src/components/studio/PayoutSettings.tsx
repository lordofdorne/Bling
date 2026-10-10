import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Landmark, Phone, Plus, Settings } from "lucide-react";
import {
  useCreatorBalance,
  usePayoutAccountSession,
  usePayoutStatus,
} from "../../lib/payouts";
import { PayoutSetup } from "../PayoutSetup";
import { Grid, GridItem } from "../Grid";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePaymentActivity } from "../../lib/finance";
import { useCreateShow, useCurrentShow } from "../../lib/shows";
import { formatDate, formatPrice } from "./format";
import { cn } from "@/lib/utils";
import { SectionHeader } from "../page";
import { useControlSize } from "../../lib/design";

// The creator-facing name for each ledger kind: money moving, not an enum.
function ledgerEntryLabel(kind: string) {
  switch (kind) {
    case "EARNING":
      return "Paid call";
    case "REFUND_REVERSAL":
      return "Refund";
    case "DISPUTE_DEBIT":
      return "Dispute hold";
    case "DISPUTE_RELEASE":
      return "Dispute released";
    case "PAYOUT_RESERVATION":
      return "Monthly payout";
    case "PAYOUT_RELEASE":
      return "Payout returned";
    default:
      return "Balance adjustment";
  }
}

function BalanceFigure({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground text-(length:--text-meta)">
        {label}
      </span>
      <strong
        className={cn(
          "font-semibold tracking-tight tabular-nums",
          emphasis ? "text-3xl" : "text-xl",
        )}
      >
        {value}
      </strong>
      <small className="text-muted-foreground text-(length:--text-meta)">
        {note}
      </small>
    </div>
  );
}

// Once a bank account is on file the creator can get paid, so this card
// points at the Hotline: live, still in setup, or off air (none yet, or the
// last one ended). Drafts and live shows link back to the studio.
function HotlineSetupCard() {
  const navigate = useNavigate();
  const currentShow = useCurrentShow();
  const createShow = useCreateShow();
  const controlSize = useControlSize();
  const show = currentShow.data;
  const studioLink = "/dashboard";

  return (
    <Card aria-label="Hotline setup">
      <CardContent className="flex flex-col gap-(--card-gap) tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex items-start gap-3">
          <span className="border-border-strong bg-background grid size-10 shrink-0 place-items-center rounded-lg border text-[var(--sand-text)]">
            <Phone className="size-5" />
          </span>
          <SectionHeader
            eyebrow="Hotline"
            title={
              show?.status === "LIVE"
                ? "Your Hotline is live"
                : show?.status === "CREATED"
                  ? "Finish setting up your Hotline"
                  : "Your Hotline is off air"
            }
            description={
              show?.status === "LIVE"
                ? "Callers can join from your public page."
                : show?.status === "CREATED"
                  ? "Configure tiers and pricing, then go live."
                  : "Set up a new Hotline whenever you're ready to take calls."
            }
          />
        </div>
        {currentShow.isPending ? null : show ? (
          <Button
            asChild
            variant="secondary"
            size={controlSize}
            className="w-full tablet:w-auto"
          >
            <Link to={studioLink}>
              {show.status === "LIVE" ? "Open studio" : "Continue setup"}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            size={controlSize}
            className="w-full tablet:w-auto"
            onClick={() =>
              createShow.mutate(undefined, {
                onSuccess: () => navigate(studioLink),
              })
            }
            disabled={createShow.isPending || currentShow.isError}
          >
            <Plus className="size-4" />
            {createShow.isPending ? "Creating…" : "Set up Hotline"}
          </Button>
        )}
        {createShow.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Unable to create your Hotline. Please try again.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export function PayoutSettings() {
  const payouts = usePayoutStatus();
  const payoutSession = usePayoutAccountSession();
  const creatorBalance = useCreatorBalance();
  const paymentActivity = usePaymentActivity();
  const controlSize = useControlSize();
  const balance = creatorBalance.data?.balance;
  const ledger = creatorBalance.data?.activity ?? [];
  const ready = payouts.data?.ready === true;
  const platformFeePercent = payouts.data?.platformFeePercent ?? 20;
  const creatorPercent = 100 - platformFeePercent;
  const setupLabel = payouts.data?.connected
    ? payouts.data.transfersStatus === "active"
      ? "Manage bank account"
      : "Continue payout setup"
    : "Set up payouts";
  const money = (cents: number | undefined) =>
    creatorBalance.isPending ? "—" : formatPrice(cents ?? 0);

  return (
    <div
      className="flex flex-col gap-(--stack-gap)"
      aria-label="Creator payouts"
    >
      <Card>
        <CardContent className="flex flex-col gap-(--card-gap)">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                ready
                  ? "bg-[var(--green-light)] ring-4 ring-[var(--green)]/20"
                  : "bg-muted-foreground",
              )}
            />
            <div className="min-w-0">
              <strong className="text-(length:--text-body) block">
                {payouts.isPending
                  ? "Checking payout account"
                  : payouts.isError
                    ? "Payout status unavailable"
                    : ready
                      ? "Payouts enabled"
                      : "Action required"}
              </strong>
              <small className="text-muted-foreground text-(length:--text-meta)">
                {ready
                  ? "Your eligible balance is paid monthly"
                  : "Finish setup before your first bank deposit"}
              </small>
            </div>
          </div>

          <div
            aria-label="Creator balance"
            className="grid grid-cols-2 gap-x-4 gap-y-(--card-gap) border-t pt-(--card-gap) laptop:grid-cols-3"
          >
            <div className="col-span-2 laptop:col-span-1">
              <BalanceFigure
                emphasis
                label="Available for next payout"
                value={money(balance?.availableCents)}
                note={`Next payout: ${
                  balance?.nextPayoutAt
                    ? formatDate(balance.nextPayoutAt, { calendarDay: true })
                    : "Paid monthly"
                }`}
              />
            </div>
            <BalanceFigure
              label="Pending clearance"
              value={money(balance?.pendingCents)}
              note="Calls still inside the earnings hold"
            />
            <BalanceFigure
              label="Total balance"
              value={money(balance?.totalCents)}
              note="Available and pending earnings"
            />
          </div>

          {!payoutSession.data && (
            <Button
              variant={ready ? "secondary" : "default"}
              size={controlSize}
              type="button"
              className="w-full tablet:w-fit"
              onClick={() => payoutSession.mutate()}
              disabled={payoutSession.isPending || payouts.isPending}
            >
              <Settings className="size-4" />
              {payoutSession.isPending ? "Opening…" : setupLabel}
            </Button>
          )}
        </CardContent>
      </Card>

      {payouts.data?.externalAccountPresent && <HotlineSetupCard />}

      {paymentActivity.data?.payoutFailure && (
        <Alert variant="destructive">
          <AlertTitle>Your latest payout needs attention.</AlertTitle>
          <AlertDescription>
            Update your payout details before another bank transfer can be sent.
            Reference: {paymentActivity.data.payoutFailure.failureCode}
          </AlertDescription>
        </Alert>
      )}

      {payoutSession.data ? (
        <Card aria-label="Secure payout setup">
          <CardContent className="flex flex-col gap-(--card-gap)">
            <SectionHeader
              eyebrow="Secure setup"
              title="Connect your payout account"
              action={
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => payoutSession.reset()}
                >
                  Close
                </Button>
              }
            />
            <PayoutSetup
              session={payoutSession.data}
              onExit={() => {
                payoutSession.reset();
                void payouts.refetch();
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <Grid>
          <GridItem span={6} tablet={8} phone={4}>
            <Card className="h-full" aria-label="Payout destination">
              <CardContent className="flex h-full flex-col gap-(--card-gap)">
                <SectionHeader
                  eyebrow="Payout destination"
                  title="Bank account"
                  action={
                    <Badge variant={ready ? "success" : "outline"}>
                      {ready ? "Verified" : "Setup needed"}
                    </Badge>
                  }
                />
                {payouts.data?.externalAccountPresent ? (
                  <div className="bg-muted flex items-center gap-3 rounded-lg p-(--inset-pad)">
                    <span className="bg-background grid size-10 shrink-0 place-items-center rounded-lg">
                      <Landmark className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <strong className="block truncate text-sm">
                        {payouts.data.externalAccountBankName || "Bank account"}
                      </strong>
                      <small className="text-muted-foreground text-xs">
                        •••• {payouts.data.externalAccountLast4}
                        {payouts.data.externalAccountCurrency
                          ? ` · ${payouts.data.externalAccountCurrency.toUpperCase()}`
                          : ""}
                      </small>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    <strong className="text-foreground block">
                      No payout account ready
                    </strong>
                    Add your identity and bank details through Stripe.
                  </p>
                )}
              </CardContent>
            </Card>
          </GridItem>

          <GridItem span={6} tablet={8} phone={4}>
            <Card className="h-full" aria-label="Earnings split">
              <CardContent className="flex flex-col gap-(--card-gap)">
                <SectionHeader
                  eyebrow="Every paid call"
                  title="Your earnings split"
                  action={
                    <span className="text-2xl font-semibold tracking-tight">
                      {creatorPercent}%
                    </span>
                  }
                />
                <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
                  <span
                    className="bg-primary rounded-l-full"
                    style={{ width: `${creatorPercent}%` }}
                  />
                  <span
                    className="bg-muted-foreground/40 rounded-r-full"
                    style={{ width: `${platformFeePercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs">
                  <span>
                    <strong className="text-sm">{creatorPercent}%</strong>{" "}
                    Creator share
                  </span>
                  <span className="text-muted-foreground">
                    <strong className="text-foreground text-sm">
                      {platformFeePercent}%
                    </strong>{" "}
                    Bling
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  You and Bling each pay half of the basic card fee. Bling
                  absorbs the extra cent when it cannot split evenly.
                </p>
              </CardContent>
            </Card>
          </GridItem>
        </Grid>
      )}

      <Card aria-label="Balance activity">
        <CardContent className="flex flex-col gap-(--card-gap)">
          <SectionHeader
            eyebrow="Balance activity"
            title="Recent transactions"
            action={
              <span className="text-muted-foreground text-xs">
                {ledger.length} {ledger.length === 1 ? "entry" : "entries"}
              </span>
            }
          />
          {creatorBalance.isError ? (
            <Alert variant="destructive">
              <AlertDescription>
                Unable to load your balance activity.
              </AlertDescription>
            </Alert>
          ) : ledger.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              <strong className="text-foreground block">
                No balance activity yet
              </strong>
              Completed paid calls and monthly payouts will appear here.
            </p>
          ) : (
            // A list, not a table: rows stay readable at phone width without
            // horizontal scrolling.
            <ul className="-mx-(--card-pad) divide-y border-t">
              {ledger.map((entry) => {
                const pending = new Date(entry.effectiveAt) > new Date();
                return (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 px-(--card-pad) py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-sm font-semibold">
                        {ledgerEntryLabel(entry.kind)}
                      </strong>
                      <small className="text-muted-foreground text-xs">
                        {formatDate(entry.createdAt)}
                      </small>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          entry.amountCents < 0 && "text-muted-foreground",
                        )}
                      >
                        {entry.amountCents > 0 ? "+" : ""}
                        {formatPrice(entry.amountCents)}
                      </span>
                      <Badge variant={pending ? "outline" : "success"}>
                        {pending ? "Pending" : "Posted"}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {payoutSession.isError && (
        <Alert variant="destructive">
          <AlertDescription>{payoutSession.error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
