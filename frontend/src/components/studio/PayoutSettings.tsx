import { Landmark, Settings } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePaymentActivity } from "../../lib/finance";
import { formatDate, formatPrice } from "./format";
import { cn } from "@/lib/utils";

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

function SectionTitle({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-[var(--sand-text)] text-[11px] font-bold tracking-[0.12em] uppercase">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-base font-bold">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

export function PayoutSettings() {
  const payouts = usePayoutStatus();
  const payoutSession = usePayoutAccountSession();
  const creatorBalance = useCreatorBalance();
  const paymentActivity = usePaymentActivity();
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

  return (
    <div className="flex flex-col gap-6" aria-label="Creator payouts">
      <Card className="py-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                ready
                  ? "bg-[var(--green-light)] ring-4 ring-[var(--green)]/20"
                  : "bg-muted-foreground",
              )}
            />
            <span className="flex flex-wrap items-baseline gap-2">
              <strong className="text-sm">
                {payouts.isPending
                  ? "Checking payout account"
                  : payouts.isError
                    ? "Payout status unavailable"
                    : ready
                      ? "Payouts enabled"
                      : "Action required"}
              </strong>
              <small className="text-muted-foreground text-xs">
                {ready
                  ? "Your eligible balance is paid monthly"
                  : "Finish setup before your first bank deposit"}
              </small>
            </span>
          </div>
          {!payoutSession.data && (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => payoutSession.mutate()}
              disabled={payoutSession.isPending || payouts.isPending}
            >
              <Settings className="size-4" />
              {payoutSession.isPending ? "Opening…" : setupLabel}
            </Button>
          )}
        </CardContent>
      </Card>

      {paymentActivity.data?.payoutFailure && (
        <Alert variant="destructive">
          <AlertTitle>Your latest payout needs attention.</AlertTitle>
          <AlertDescription>
            Update your payout details before another bank transfer can be sent.
            Reference: {paymentActivity.data.payoutFailure.failureCode}
          </AlertDescription>
        </Alert>
      )}

      <Grid aria-label="Creator balance">
        <GridItem span={4} tablet={8} phone={4}>
          <Card className="border-primary/40 relative h-full overflow-hidden">
            <span
              className="bg-primary absolute inset-x-0 top-0 h-1"
              aria-hidden="true"
            />
            <CardContent>
              <span className="text-muted-foreground text-xs">
                Available for next payout
              </span>
              <strong className="mt-2 block text-3xl font-semibold tracking-tight">
                {creatorBalance.isPending
                  ? "—"
                  : formatPrice(balance?.availableCents ?? 0)}
              </strong>
              <small className="text-muted-foreground mt-1 block text-xs">
                Next payout:{" "}
                {balance?.nextPayoutAt
                  ? formatDate(balance.nextPayoutAt)
                  : "Paid monthly"}
              </small>
            </CardContent>
          </Card>
        </GridItem>
        <GridItem span={4} tablet={4} phone={4}>
          <Card className="h-full">
            <CardContent>
              <span className="text-muted-foreground text-xs">
                Pending clearance
              </span>
              <strong className="mt-2 block text-3xl font-semibold tracking-tight">
                {creatorBalance.isPending
                  ? "—"
                  : formatPrice(balance?.pendingCents ?? 0)}
              </strong>
              <small className="text-muted-foreground mt-1 block text-xs">
                Calls still inside the earnings hold
              </small>
            </CardContent>
          </Card>
        </GridItem>
        <GridItem span={4} tablet={4} phone={4}>
          <Card className="h-full">
            <CardContent>
              <span className="text-muted-foreground text-xs">
                Total balance
              </span>
              <strong className="mt-2 block text-3xl font-semibold tracking-tight">
                {creatorBalance.isPending
                  ? "—"
                  : formatPrice(balance?.totalCents ?? 0)}
              </strong>
              <small className="text-muted-foreground mt-1 block text-xs">
                Available and pending earnings
              </small>
            </CardContent>
          </Card>
        </GridItem>
      </Grid>

      {payoutSession.data ? (
        <Card aria-label="Secure payout setup">
          <CardContent className="flex flex-col gap-4">
            <SectionTitle
              eyebrow="Secure setup"
              title="Connect your payout account"
              aside={
                <Button
                  variant="link"
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
              <CardContent className="flex flex-col gap-4">
                <SectionTitle
                  eyebrow="Payout destination"
                  title="Bank account"
                  aside={
                    <Badge variant={ready ? "success" : "outline"}>
                      {ready ? "Verified" : "Setup needed"}
                    </Badge>
                  }
                />
                {payouts.data?.externalAccountPresent ? (
                  <div className="bg-muted flex items-center gap-3 rounded-lg p-3">
                    <span className="bg-background grid size-10 place-items-center rounded-lg">
                      <Landmark className="size-5" />
                    </span>
                    <div>
                      <strong className="block text-sm">
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
                  <div>
                    <strong className="block text-sm">
                      No payout account ready
                    </strong>
                    <span className="text-muted-foreground text-sm">
                      Add your identity and bank details through Stripe.
                    </span>
                  </div>
                )}
                <Button
                  variant="link"
                  className="mt-auto h-auto justify-start px-0"
                  type="button"
                  onClick={() => payoutSession.mutate()}
                  disabled={payoutSession.isPending}
                >
                  {setupLabel}
                </Button>
              </CardContent>
            </Card>
          </GridItem>

          <GridItem span={6} tablet={8} phone={4}>
            <Card className="h-full" aria-label="Earnings split">
              <CardContent className="flex flex-col gap-4">
                <SectionTitle
                  eyebrow="Every paid call"
                  title="Your earnings split"
                  aside={
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
        <CardContent className="flex flex-col gap-4">
          <SectionTitle
            eyebrow="Balance activity"
            title="Recent transactions"
            aside={
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
            <div className="text-muted-foreground py-6 text-sm">
              <strong className="text-foreground block">
                No balance activity yet
              </strong>
              Completed paid calls and monthly payouts will appear here.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.map((entry) => {
                  const pending = new Date(entry.effectiveAt) > new Date();
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <strong className="block text-sm font-semibold">
                          {ledgerEntryLabel(entry.kind)}
                        </strong>
                        <small className="text-muted-foreground text-xs capitalize">
                          {entry.kind.replaceAll("_", " ").toLowerCase()}
                        </small>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(entry.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={pending ? "outline" : "success"}>
                          {pending ? "Pending" : "Posted"}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-semibold tabular-nums",
                          entry.amountCents < 0 && "text-muted-foreground",
                        )}
                      >
                        {entry.amountCents > 0 ? "+" : ""}
                        {formatPrice(entry.amountCents)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
