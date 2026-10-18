import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { Settings } from "lucide-react";
import {
  useCreatorBalance,
  useCreatorEarnings,
  usePayoutAccountSession,
  usePayoutStatus,
  type EarningsDay,
  type LedgerEntry,
} from "../../lib/payouts";
import { usePaymentActivity } from "../../lib/finance";
import { useControlSize } from "../../lib/design";
import { PAYOUT_TERMS } from "../../lib/site";
import { PayoutSetup } from "../PayoutSetup";
import { Grid, GridItem } from "../Grid";
import { SectionHeader } from "../page";
import { formatDate, formatPrice, formatSignedPrice } from "./format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// Creator payouts, laid out like other creator platforms' earnings pages:
// what you can be paid and when, how earnings are trending, and every
// balance movement. The revenue split lives in the Terms, not here.

export function PayoutSettings() {
  const payouts = usePayoutStatus();
  const payoutSession = usePayoutAccountSession();
  const paymentActivity = usePaymentActivity();
  const failure = paymentActivity.data?.payoutFailure;
  const ready = payouts.data?.ready === true;

  return (
    <div
      className="flex flex-col gap-(--stack-gap)"
      aria-label="Creator payouts"
    >
      {failure && (
        <Alert variant="destructive">
          <AlertTitle>Your latest payout needs attention.</AlertTitle>
          <AlertDescription>
            Update your bank details before another payout can be sent.
            Reference: {failure.failureCode}
          </AlertDescription>
        </Alert>
      )}

      {payoutSession.data ? (
        <Card aria-label="Secure payout setup">
          <CardContent className="flex flex-col gap-(--card-gap)">
            <SectionHeader
              eyebrow="Secure setup"
              title="Your payout account"
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
        !payouts.isPending && !ready && <SetupPrompt />
      )}

      {payoutSession.isError && (
        <Alert variant="destructive">
          <AlertDescription>{payoutSession.error.message}</AlertDescription>
        </Alert>
      )}

      <Grid>
        <GridItem span={4} tablet={8} phone={4}>
          <BalanceCard />
        </GridItem>
        <GridItem span={8} tablet={8} phone={4}>
          <EarningsCard />
        </GridItem>
      </Grid>

      <ActivityCard />
    </div>
  );
}

/** Shown until Stripe has verified the creator's identity and bank. */
function SetupPrompt() {
  const payouts = usePayoutStatus();
  const payoutSession = usePayoutAccountSession();
  const controlSize = useControlSize();
  const started = payouts.data?.connected === true;

  return (
    <Card aria-label="Payout setup">
      <CardContent className="flex flex-col gap-(--card-gap) tablet:flex-row tablet:items-center tablet:justify-between">
        <SectionHeader
          title={started ? "Finish payout setup" : "Set up payouts"}
          description={
            payouts.isError
              ? "Payout status is unavailable right now. Try again shortly."
              : started
                ? "Stripe needs a few more details before your first payout."
                : "Add your identity and bank details through Stripe to get paid for calls."
          }
        />
        <Button
          size={controlSize}
          type="button"
          className="w-full tablet:w-auto"
          onClick={() => payoutSession.mutate()}
          disabled={payoutSession.isPending}
        >
          {payoutSession.isPending
            ? "Opening…"
            : started
              ? "Continue setup"
              : "Set up payouts"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------ balance

function BalanceCard() {
  const payouts = usePayoutStatus();
  const creatorBalance = useCreatorBalance();
  const payoutSession = usePayoutAccountSession();
  const controlSize = useControlSize();
  const balance = creatorBalance.data?.balance;
  const ready = payouts.data?.ready === true;
  const money = (cents: number | undefined) =>
    creatorBalance.isPending ? "—" : formatPrice(cents ?? 0);
  const nextPayout = balance?.nextPayoutAt
    ? formatDate(balance.nextPayoutAt, { calendarDay: true })
    : "—";
  const bank = payouts.data?.externalAccountPresent
    ? `${payouts.data.externalAccountBankName || "Bank"} •••• ${payouts.data.externalAccountLast4}`
    : "Not added";

  return (
    <Card className="h-full" aria-label="Balance">
      <CardContent className="flex h-full flex-col gap-(--card-gap)">
        <SectionHeader
          title="Balance"
          action={
            payouts.isPending ? null : (
              <Badge variant={ready ? "success" : "outline"}>
                {ready ? "Payouts on" : "Setup needed"}
              </Badge>
            )
          }
        />

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-(length:--text-meta)">
            Available for payout
          </span>
          <strong className="text-(length:--text-page-title) leading-none font-bold tracking-tight tabular-nums">
            {money(balance?.availableCents)}
          </strong>
        </div>

        <dl className="divide-y border-y text-(length:--text-body)">
          <BalanceRow
            label="On hold"
            hint={`Clears ${PAYOUT_TERMS.earningsHoldDays} days after each call`}
            value={money(balance?.pendingCents)}
          />
          <BalanceRow label="Next payout" value={nextPayout} />
          {payouts.data && (
            <BalanceRow
              label="Your share"
              hint={
                100 - payouts.data.platformFeePercent >
                PAYOUT_TERMS.creatorSharePercent
                  ? "Beta rate, locked in when you joined"
                  : "Less half the card fee"
              }
              value={`${100 - payouts.data.platformFeePercent}% per call`}
            />
          )}
          <BalanceRow
            label="Schedule"
            value={`Monthly, $${PAYOUT_TERMS.payoutMinimumDollars} minimum`}
          />
          <BalanceRow label="Bank account" value={bank} />
        </dl>

        {payouts.data?.connected && !payoutSession.data && (
          <Button
            variant="secondary"
            size={controlSize}
            type="button"
            className="mt-auto w-full"
            onClick={() => payoutSession.mutate()}
            disabled={payoutSession.isPending}
          >
            <Settings className="size-4" />
            {payoutSession.isPending ? "Opening…" : "Manage bank account"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function BalanceRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="min-w-0">
        <span className="block">{label}</span>
        {hint && (
          <span className="text-muted-foreground block text-(length:--text-meta)">
            {hint}
          </span>
        )}
      </dt>
      <dd className="min-w-0 truncate text-right font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  );
}

// ------------------------------------------------------------ earnings

type Range = "30d" | "12m";

const chartConfig = {
  cents: { label: "Earnings", color: "var(--accent)" },
} satisfies ChartConfig;

type Point = { key: string; label: string; title: string; cents: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (date: Date) => date.toISOString().slice(0, 10);
const utcLabel = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    date,
  );

/** Fills in quiet days (or months) so the chart has an even axis. */
function buildSeries(days: EarningsDay[], range: Range): Point[] {
  const today = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS);
  if (range === "30d") {
    const totals = new Map(days.map((day) => [day.date, day.cents]));
    return Array.from({ length: 30 }, (_, index) => {
      const date = new Date(today.getTime() - (29 - index) * DAY_MS);
      const key = utcDay(date);
      return {
        key,
        label: utcLabel(date, { month: "short", day: "numeric" }),
        title: utcLabel(date, {
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
        cents: totals.get(key) ?? 0,
      };
    });
  }
  const totals = new Map<string, number>();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + day.cents);
  }
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (11 - index), 1),
    );
    const key = utcDay(date).slice(0, 7);
    return {
      key,
      label: utcLabel(date, { month: "short" }),
      title: utcLabel(date, { month: "long", year: "numeric" }),
      cents: totals.get(key) ?? 0,
    };
  });
}

function EarningsCard() {
  const [range, setRange] = useState<Range>("30d");
  const earnings = useCreatorEarnings(range === "30d" ? 30 : 366);
  const series = useMemo(
    () => buildSeries(earnings.data?.days ?? [], range),
    [earnings.data, range],
  );
  const total = series.reduce((sum, point) => sum + point.cents, 0);
  const empty = !earnings.isPending && series.every((point) => !point.cents);

  return (
    <Card className="h-full" aria-label="Earnings">
      <CardContent className="flex h-full flex-col gap-(--card-gap)">
        <SectionHeader
          title="Earnings"
          action={
            <Tabs
              value={range}
              onValueChange={(value) => setRange(value as Range)}
            >
              <TabsList aria-label="Earnings period">
                <TabsTrigger value="30d">30 days</TabsTrigger>
                <TabsTrigger value="12m">12 months</TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-(length:--text-meta)">
            {range === "30d" ? "Last 30 days" : "Last 12 months"}, after refunds
          </span>
          <strong className="text-(length:--text-page-title) leading-none font-bold tracking-tight tabular-nums">
            {earnings.isPending ? "—" : formatPrice(total)}
          </strong>
        </div>

        {earnings.isError ? (
          <Alert variant="destructive">
            <AlertDescription>Unable to load your earnings.</AlertDescription>
          </Alert>
        ) : (
          <div className="relative mt-auto">
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-48 w-full"
              aria-hidden={empty}
            >
              <BarChart data={series} margin={{ left: 0, right: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      hideIndicator
                      labelFormatter={(_, payload) =>
                        (payload?.[0]?.payload as Point | undefined)?.title
                      }
                      formatter={(value) => (
                        <span className="font-semibold tabular-nums">
                          {formatPrice(Number(value))}
                        </span>
                      )}
                    />
                  }
                />
                <Bar dataKey="cents" fill="var(--color-cents)" radius={4} />
              </BarChart>
            </ChartContainer>
            {empty && (
              <p className="text-muted-foreground absolute inset-0 grid place-items-center text-center text-(length:--text-meta)">
                Earnings from paid calls will show here.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------ activity

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
      return "Payout to bank";
    case "PAYOUT_RELEASE":
      return "Payout returned";
    default:
      return "Balance adjustment";
  }
}

function entryStatus(entry: LedgerEntry) {
  const pending = new Date(entry.effectiveAt) > new Date();
  return {
    pending,
    badge: (
      <Badge variant={pending ? "outline" : "success"}>
        {pending ? "On hold" : "Cleared"}
      </Badge>
    ),
    note: pending ? `Clears ${formatDate(entry.effectiveAt)}` : undefined,
  };
}

function Amount({ cents }: { cents: number }) {
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        cents < 0 && "text-muted-foreground",
      )}
    >
      {formatSignedPrice(cents)}
    </span>
  );
}

function ActivityCard() {
  const creatorBalance = useCreatorBalance();
  // Newest first by when it happened (the Go API orders by when it clears).
  const entries = useMemo(
    () =>
      [...(creatorBalance.data?.activity ?? [])].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    [creatorBalance.data],
  );

  return (
    <Card aria-label="Balance activity">
      <CardContent className="flex flex-col gap-(--card-gap)">
        <SectionHeader
          title="Activity"
          description="Paid calls, refunds and payouts, newest first."
        />
        {creatorBalance.isError ? (
          <Alert variant="destructive">
            <AlertDescription>Unable to load your activity.</AlertDescription>
          </Alert>
        ) : creatorBalance.isPending ? null : entries.length === 0 ? (
          <p className="text-muted-foreground text-(length:--text-body)">
            Nothing yet. Paid calls and payouts will appear here.
          </p>
        ) : (
          <>
            {/* Phones: compact rows. */}
            <ul className="-mx-(--card-pad) divide-y border-t tablet:hidden">
              {entries.map((entry) => {
                const status = entryStatus(entry);
                return (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 px-(--card-pad) py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-(length:--text-body) font-semibold">
                        {ledgerEntryLabel(entry.kind)}
                      </strong>
                      <small className="text-muted-foreground text-(length:--text-meta)">
                        {formatDate(entry.createdAt)}
                        {status.note ? ` · ${status.note}` : ""}
                      </small>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Amount cents={entry.amountCents} />
                      {status.badge}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Tablet and up: a table. */}
            <div className="-mx-(--card-pad) max-tablet:hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-(--card-pad)">Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-(--card-pad) text-right">
                      Amount
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const status = entryStatus(entry);
                    return (
                      <TableRow key={entry.id}>
                        <TableCell className="text-muted-foreground pl-(--card-pad)">
                          {formatDate(entry.createdAt)}
                        </TableCell>
                        <TableCell className="font-medium">
                          {ledgerEntryLabel(entry.kind)}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            {status.badge}
                            {status.note && (
                              <span className="text-muted-foreground text-(length:--text-meta)">
                                {status.note}
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="pr-(--card-pad) text-right">
                          <Amount cents={entry.amountCents} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
