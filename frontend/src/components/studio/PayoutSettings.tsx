import { usePayoutAccountSession, usePayoutStatus } from "../../lib/payouts";
import { useCreatorBalance } from "../../lib/payouts";
import { usePaymentActivity } from "../../lib/finance";
import { PayoutSetup } from "../PayoutSetup";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  LEDGER_LABELS,
  formatDate,
  formatPrice,
  formatSignedPrice,
} from "./format";

export function PayoutSettings() {
  const payouts = usePayoutStatus();
  const payoutSession = usePayoutAccountSession();
  const creatorBalance = useCreatorBalance();
  const paymentActivity = usePaymentActivity();
  const balance = creatorBalance.data?.balance;
  const activity = creatorBalance.data?.activity ?? [];
  const status = payouts.data;
  const ready = status?.ready === true;

  // Stripe's embedded onboarding owns the page while it is open.
  if (payoutSession.data) {
    return (
      <section aria-label="Creator payouts" className="flex flex-col gap-4">
        <h2 className="text-xl font-bold tracking-tight">Payout setup</h2>
        <Card>
          <CardContent>
            <PayoutSetup
              session={payoutSession.data}
              onExit={() => {
                payoutSession.reset();
                void payouts.refetch();
              }}
            />
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section aria-label="Creator payouts" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Payouts</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            What you have earned, what is still clearing, and where it lands.
          </p>
        </div>
        <Badge variant={ready ? "success" : "outline"} className="px-3 py-1.5">
          {payouts.isPending
            ? "Checking…"
            : payouts.isError
              ? "Unavailable"
              : ready
                ? "Ready"
                : status?.connected
                  ? "Action needed"
                  : "Not set up"}
        </Badge>
      </header>

      {paymentActivity.data?.payoutFailure && (
        <Alert variant="destructive">
          <AlertTitle>Your latest payout needs attention.</AlertTitle>
          <AlertDescription>
            Update your payout details before another bank transfer can be sent.
            Reference: {paymentActivity.data.payoutFailure.failureCode}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">Available to pay out</p>
          <p className="text-4xl font-semibold tracking-tight">
            {balance ? formatPrice(balance.availableCents) : "—"}
          </p>
          <p className="text-muted-foreground text-sm">
            {creatorBalance.isError
              ? "Your balance is unavailable right now."
              : !balance
                ? "Checking your balance…"
                : balance.pendingCents > 0
                  ? `${formatPrice(balance.pendingCents)} is still clearing.`
                  : balance.totalCents === 0
                    ? "Your share of a paid call lands here."
                    : "Everything you have earned has cleared."}
          </p>
        </CardContent>
      </Card>

      {payouts.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            Unable to load your payout status.
          </AlertDescription>
        </Alert>
      ) : (
        status &&
        !ready && (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-[240px] flex-1">
                <strong className="text-base">
                  {status.connected
                    ? status.transfersStatus === "active"
                      ? "Add your bank account"
                      : "Finish your payout setup"
                    : "Set up payouts to charge for calls"}
                </strong>
                <p className="text-muted-foreground mt-1 text-sm">
                  Add your identity and bank details. Paid tiers unlock as soon
                  as Stripe confirms them.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => payoutSession.mutate()}
                disabled={payoutSession.isPending}
              >
                {payoutSession.isPending
                  ? "Opening secure setup…"
                  : status.connected
                    ? status.transfersStatus === "active"
                      ? "Add bank account"
                      : "Continue setup"
                    : "Set up payouts"}
              </Button>
            </CardContent>
          </Card>
        )
      )}

      {payoutSession.isError && (
        <Alert variant="destructive">
          <AlertDescription>{payoutSession.error.message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          <dl className="text-sm">
            <Fact
              label="Next payout"
              value={
                balance?.nextPayoutAt
                  ? formatDate(balance.nextPayoutAt)
                  : ready
                    ? "Scheduled monthly"
                    : "Not scheduled"
              }
            />
            <Separator />
            <Fact
              label="Payout method"
              value={
                ready
                  ? status.externalAccountPresent
                    ? `${status.externalAccountBankName || "Bank account"} •••• ${status.externalAccountLast4}`
                    : "Verified with Stripe"
                  : "Not set up"
              }
              action={
                ready ? (
                  <Button
                    variant="link"
                    className="h-auto px-0"
                    type="button"
                    onClick={() => payoutSession.mutate()}
                    disabled={payoutSession.isPending}
                  >
                    {payoutSession.isPending ? "Opening…" : "Edit"}
                  </Button>
                ) : undefined
              }
            />
            <Separator />
            <Fact
              label="Total balance"
              value={balance ? formatPrice(balance.totalCents) : "—"}
            />
            <Separator />
            <Fact
              label="Your share"
              value={`${100 - (status?.platformFeePercent ?? 20)}% of each paid call`}
            />
          </dl>
          <p className="text-muted-foreground mt-4 text-xs">
            Bling keeps {status?.platformFeePercent ?? 20}% and pays half of the
            basic card fee (2.9% + $0.30). Your half is taken from your share.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h3 className="text-base font-semibold">Recent activity</h3>
          {creatorBalance.isPending ? (
            <p className="text-muted-foreground mt-4 text-sm">
              Loading your balance activity…
            </p>
          ) : activity.length === 0 ? (
            <p className="text-muted-foreground mt-4 text-sm">
              Nothing yet. Your share of a paid call appears here once the call
              goes live.
            </p>
          ) : (
            <ul className="mt-2">
              {activity.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-baseline justify-between gap-4 border-b py-4 last:border-b-0 last:pb-0"
                >
                  <div>
                    <strong className="text-sm font-semibold">
                      {LEDGER_LABELS[entry.kind] ?? entry.kind}
                    </strong>
                    <p className="text-muted-foreground text-xs">
                      {formatDate(entry.effectiveAt)}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-semibold tabular-nums ${entry.amountCents < 0 ? "text-muted-foreground" : ""}`}
                  >
                    {formatSignedPrice(entry.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Fact({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 flex items-baseline gap-4 text-right">
        <span>{value}</span>
        {action}
      </dd>
    </div>
  );
}
