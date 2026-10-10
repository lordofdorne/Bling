import { v } from "convex/values";
import type Stripe from "stripe";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { requireCreatorId } from "./lib/auth";
import { fail } from "./lib/errors";
import { balanceAt, postEntry } from "./lib/ledger";
import { PLATFORM_FEE_BPS, publishableKey, stripeClient } from "./lib/stripe";

// Creator payouts. Ported from backend/internal/payout (Connect accounts)
// and backend/internal/balance (balances and the monthly transfer run).
//
// Creators get a Stripe Accounts v2 recipient account and onboard inside
// Bling with Connect's embedded component. Bling keeps every call payment in
// its platform balance, credits the creator's share to the ledger, and once a
// month transfers each creator's available balance to their connected
// account; Stripe then pays it out to their bank.
//
// Environment: STRIPE_CONNECT_COUNTRY (default US), CREATOR_PAYOUTS_ENABLED
// (default false), CREATOR_PAYOUT_DAY (1-28, default 1),
// CREATOR_PAYOUT_MINIMUM_CENTS (default 2500), CREATOR_PAYOUT_CURRENCY
// (default usd), CREATOR_EARNINGS_HOLD_HOURS (default 168, lib/ledger.ts).

const PLATFORM_FEE_PERCENT = PLATFORM_FEE_BPS / 100;
const CREATOR_PROCESSING_FEE_PERCENT = 50;
const MAX_TRANSFER_ATTEMPTS = 10;
const TRANSFER_LEASE_MS = 5 * 60_000;
const RESERVE_BATCH = 100;

function config() {
  const day = Number(process.env.CREATOR_PAYOUT_DAY ?? 1);
  const minimum = Number(process.env.CREATOR_PAYOUT_MINIMUM_CENTS ?? 2500);
  return {
    enabled:
      (process.env.CREATOR_PAYOUTS_ENABLED ?? "").toLowerCase() === "true",
    payoutDay: Number.isInteger(day) && day >= 1 && day <= 28 ? day : 1,
    minimumCents: Number.isInteger(minimum) && minimum > 0 ? minimum : 2500,
    currency: (process.env.CREATOR_PAYOUT_CURRENCY ?? "usd").toLowerCase(),
    country: (process.env.STRIPE_CONNECT_COUNTRY ?? "US").toUpperCase(),
  };
}

// ------------------------------------------------------------ accounts

type AccountFields = Omit<
  Doc<"payoutAccounts">,
  "_id" | "_creationTime" | "creatorId"
>;

export function accountReady(account: AccountFields | null | undefined) {
  return Boolean(
    account?.stripeAccountId &&
      account.transfersStatus === "active" &&
      account.bankPayoutsStatus === "active" &&
      account.externalAccountPresent &&
      account.detailsSubmitted,
  );
}

function statusFor(account: AccountFields | null) {
  return {
    connected: Boolean(account),
    transfersStatus: account?.transfersStatus ?? "",
    bankPayoutsStatus: account?.bankPayoutsStatus ?? "",
    externalAccountPresent: account?.externalAccountPresent ?? false,
    externalAccountBankName: account?.externalAccountBankName,
    externalAccountLast4: account?.externalAccountLast4,
    externalAccountCurrency: account?.externalAccountCurrency,
    payoutsEnabled: account?.bankPayoutsStatus === "active",
    detailsSubmitted: account?.detailsSubmitted ?? false,
    ready: accountReady(account),
    requirementsDue: account?.requirementsDue ?? [],
    platformFeePercent: PLATFORM_FEE_PERCENT,
    creatorProcessingFeePercent: CREATOR_PROCESSING_FEE_PERCENT,
  };
}

const ACCOUNT_INCLUDES = ["configuration.recipient", "requirements"] as const;

/**
 * Projects a v2 account (plus its bank accounts) onto what Bling stores.
 * Only requirements awaiting the creator count, and only currently-due or
 * past-due ones block: Stripe leaves eventually-due items open on freshly
 * onboarded accounts, and treating those as blocking traps creators in setup.
 * An entry without a deadline blocks, failing closed.
 */
export function projectAccount(
  account: Stripe.V2.Core.Account,
  banks: Stripe.BankAccount[],
): AccountFields {
  const balance =
    account.configuration?.recipient?.capabilities?.stripe_balance;
  const requirementsDue: string[] = [];
  let blocked = false;
  for (const entry of account.requirements?.entries ?? []) {
    if (entry.awaiting_action_from !== "user") continue;
    if (entry.description) requirementsDue.push(entry.description);
    const deadline = entry.minimum_deadline?.status;
    if (!deadline || deadline === "currently_due" || deadline === "past_due") {
      blocked = true;
    }
  }
  const usable = banks.filter(
    (bank) =>
      !(bank as { deleted?: boolean }).deleted &&
      ![
        "errored",
        "verification_failed",
        "tokenized_account_number_deactivated",
      ].includes(bank.status),
  );
  const bank = usable.find((value) => value.default_for_currency) ?? usable[0];
  return {
    stripeAccountId: account.id,
    transfersStatus: balance?.stripe_transfers?.status ?? "",
    bankPayoutsStatus: balance?.payouts?.status ?? "",
    externalAccountPresent: Boolean(bank),
    externalAccountBankName: bank?.bank_name ?? undefined,
    externalAccountLast4: bank?.last4,
    externalAccountCurrency: bank?.currency,
    detailsSubmitted: !blocked,
    requirementsDue,
  };
}

async function readAccount(stripe: Stripe, accountId: string) {
  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: [...ACCOUNT_INCLUDES],
  });
  const banks = await stripe.accounts.listExternalAccounts(accountId, {
    object: "bank_account",
    limit: 10,
  });
  return projectAccount(account, banks.data as Stripe.BankAccount[]);
}

async function providerCall<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    // Stripe's message is for the operator (it can name parameters or echo a
    // masked key), so it goes to the log, never to the creator.
    const { type, code, statusCode, requestId } = error as Record<
      string,
      unknown
    >;
    console.error("Stripe payout request failed", {
      type,
      code,
      statusCode,
      requestId,
    });
    fail("PAYOUT_PROVIDER_ERROR");
  }
}

export const creator = internalQuery({
  args: {},
  handler: async (ctx) => {
    const creatorId = await requireCreatorId(ctx);
    const user = (await ctx.db.get(creatorId))!;
    const account = await ctx.db
      .query("payoutAccounts")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .first();
    return { creatorId, email: user.email ?? "", account };
  },
});

export const saveAccount = internalMutation({
  args: {
    creatorId: v.id("users"),
    account: v.object({
      stripeAccountId: v.string(),
      transfersStatus: v.string(),
      bankPayoutsStatus: v.string(),
      externalAccountPresent: v.boolean(),
      externalAccountBankName: v.optional(v.string()),
      externalAccountLast4: v.optional(v.string()),
      externalAccountCurrency: v.optional(v.string()),
      detailsSubmitted: v.boolean(),
      requirementsDue: v.array(v.string()),
    }),
  },
  handler: async (ctx, { creatorId, account }) => {
    const existing = await ctx.db
      .query("payoutAccounts")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .first();
    if (!existing) {
      await ctx.db.insert("payoutAccounts", { creatorId, ...account });
      return;
    }
    // A creator keeps their first account; a different id is never adopted.
    if (existing.stripeAccountId !== account.stripeAccountId) return;
    await ctx.db.replace(existing._id, { creatorId, ...account });
  },
});

/**
 * The creator's payout setup, refreshed from Stripe. Call it when the
 * settings page opens and after onboarding, so a creator who has just
 * finished is ready at once rather than when the webhook lands.
 */
export const status = action({
  args: {},
  handler: async (ctx): Promise<ReturnType<typeof statusFor>> => {
    const { creatorId, account } = await ctx.runQuery(
      internal.payouts.creator,
      {},
    );
    if (!account) return statusFor(null);
    const refreshed = await providerCall(() =>
      readAccount(stripeClient(), account.stripeAccountId),
    );
    await ctx.runMutation(internal.payouts.saveAccount, {
      creatorId,
      account: refreshed,
    });
    return statusFor(refreshed);
  },
});

/** Stored payout status without calling Stripe, for reactive UI. */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const creatorId = await requireCreatorId(ctx);
    const account = await ctx.db
      .query("payoutAccounts")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .first();
    return statusFor(account);
  },
});

/**
 * A client secret for Connect's embedded onboarding, creating the creator's
 * recipient account the first time.
 */
export const accountSession = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ clientSecret: string; publishableKey: string }> => {
    const stripe = stripeClient();
    const key = publishableKey();
    const accountId = await ensureAccount(ctx, stripe);
    const session = await providerCall(() =>
      stripe.accountSessions.create({
        account: accountId,
        components: {
          account_onboarding: {
            enabled: true,
            features: { external_account_collection: true },
          },
        },
      }),
    );
    return { clientSecret: session.client_secret, publishableKey: key };
  },
});

async function ensureAccount(ctx: ActionCtx, stripe: Stripe): Promise<string> {
  const { creatorId, email, account } = await ctx.runQuery(
    internal.payouts.creator,
    {},
  );
  if (account) return account.stripeAccountId;
  // A recipient that only receives transfers, with no Stripe dashboard and
  // Bling responsible for fees and losses (Bling is merchant of record).
  const created = await providerCall(() =>
    stripe.v2.core.accounts.create(
      {
        contact_email: email,
        display_name: email,
        dashboard: "none",
        identity: { country: config().country },
        defaults: {
          responsibilities: {
            fees_collector: "application",
            losses_collector: "application",
          },
        },
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: { stripe_transfers: { requested: true } },
            },
          },
        },
        include: [...ACCOUNT_INCLUDES],
        metadata: { bling_creator_id: creatorId },
      },
      { idempotencyKey: `bling-connect-account-v2-${creatorId}` },
    ),
  );
  await ctx.runMutation(internal.payouts.saveAccount, {
    creatorId,
    account: projectAccount(created, []),
  });
  return created.id;
}

/**
 * Re-reads a connected account after Stripe's account.updated webhook. The
 * event's own payload is the v1 shape and does not describe the v2
 * capability readiness rests on, so only its account id is used.
 */
export const reconcileAccount = internalAction({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, { stripeAccountId }) => {
    const creatorId = await ctx.runQuery(internal.payouts.creatorForAccount, {
      stripeAccountId,
    });
    if (!creatorId) return;
    const account = await readAccount(stripeClient(), stripeAccountId);
    await ctx.runMutation(internal.payouts.saveAccount, { creatorId, account });
  },
});

export const creatorForAccount = internalQuery({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, { stripeAccountId }) =>
    (
      await ctx.db
        .query("payoutAccounts")
        .withIndex("by_stripe_account", (q) =>
          q.eq("stripeAccountId", stripeAccountId),
        )
        .first()
    )?.creatorId ?? null,
});

// ------------------------------------------------------------ balance

function nextPayoutAt(now: number, day: number) {
  const date = new Date(now);
  let candidate = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day);
  if (candidate <= now) {
    candidate = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, day);
  }
  return candidate;
}

/**
 * The creator's balance and latest ledger activity. Held vs available is
 * worked out at query time, so it can lag by however long the query result
 * stays cached; payout runs always use the exact time.
 */
export const balance = query({
  args: {},
  handler: async (ctx) => {
    const creatorId = await requireCreatorId(ctx);
    const { currency, payoutDay } = config();
    const now = Date.now();
    const summary = await balanceAt(ctx, creatorId, currency, now);
    const activity = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_creator_currency", (q) =>
        q.eq("creatorId", creatorId).eq("currency", currency),
      )
      .order("desc")
      .take(25);
    return {
      balance: { ...summary, nextPayoutAt: nextPayoutAt(now, payoutDay) },
      activity: activity.map((entry) => ({
        _id: entry._id,
        kind: entry.kind,
        amountCents: entry.amountCents,
        currency: entry.currency,
        effectiveAt: entry.effectiveAt,
        createdAt: entry._creationTime,
      })),
    };
  },
});

// Ledger kinds that change what a creator earned, as opposed to payouts,
// which only move money they already earned to their bank.
const EARNING_KINDS = new Set([
  "EARNING",
  "REFUND_REVERSAL",
  "DISPUTE_DEBIT",
  "DISPUTE_RELEASE",
]);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EARNINGS_DAYS = 366;
// Reads at most this many entries; far more paid calls than any one creator
// makes in a year today. Older days drop off first if it is ever reached.
const EARNINGS_SCAN_LIMIT = 8000;

/**
 * Net earnings per UTC day over the last `days` days (paid calls, less
 * refunds and dispute holds), for the payouts chart. Days without activity
 * are left out; the client fills them in. A day is when the money was
 * earned, not when the hold clears.
 */
export const earnings = query({
  args: { days: v.number() },
  handler: async (ctx, { days }) => {
    const creatorId = await requireCreatorId(ctx);
    const { currency } = config();
    const span = Math.min(Math.max(Math.floor(days), 1), MAX_EARNINGS_DAYS);
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const since = today - (span - 1) * DAY_MS;
    // Effective dates are the earning time plus the hold (or later), so
    // everything earned since `since` has an effective date after it.
    const entries = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_creator_currency_effective", (q) =>
        q
          .eq("creatorId", creatorId)
          .eq("currency", currency)
          .gte("effectiveAt", since),
      )
      .order("desc")
      .take(EARNINGS_SCAN_LIMIT);
    const totals = new Map<string, number>();
    for (const entry of entries) {
      if (!EARNING_KINDS.has(entry.kind) || entry._creationTime < since) {
        continue;
      }
      const day = new Date(entry._creationTime).toISOString().slice(0, 10);
      totals.set(day, (totals.get(day) ?? 0) + entry.amountCents);
    }
    return {
      currency,
      days: [...totals]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, cents]) => ({ date, cents })),
    };
  },
});

/** The creator's most recent bank payout failure, unless a later one paid. */
export const latestFailure = query({
  args: {},
  handler: async (ctx) => {
    const creatorId = await requireCreatorId(ctx);
    for await (const event of ctx.db
      .query("payoutEvents")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .order("desc")) {
      if (event.status === "paid") return null;
      if (event.status === "failed") {
        return {
          payoutId: event.stripePayoutId,
          amountCents: event.amountCents,
          currency: event.currency,
          failureCode: event.failureCode ?? "",
          failureMessage: event.failureMessage ?? "",
        };
      }
    }
    return null;
  },
});

// ------------------------------------------------------------ monthly run

/** The month a run on `now` pays out: the month before this payout day. */
export function payoutPeriod(now: number, payoutDay: number) {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  let month = date.getUTCMonth();
  if (date.getUTCDate() < payoutDay) month -= 1;
  const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
  return {
    periodStart: iso(Date.UTC(year, month - 1, 1)),
    periodEnd: iso(Date.UTC(year, month, 1)),
  };
}

/**
 * Hourly (crons.ts). Off unless CREATOR_PAYOUTS_ENABLED=true. Opens this
 * period's run if needed and reserves every eligible creator's available
 * balance, in batches. Re-running is safe: a creator gets one item per run
 * and never while an earlier payout is unsettled.
 */
export const runDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { enabled, payoutDay, currency } = config();
    if (!enabled) return;
    const { periodStart, periodEnd } = payoutPeriod(Date.now(), payoutDay);
    const existing = await ctx.db
      .query("payoutRuns")
      .withIndex("by_period", (q) =>
        q.eq("periodStart", periodStart).eq("currency", currency),
      )
      .first();
    const runId =
      existing?._id ??
      (await ctx.db.insert("payoutRuns", {
        periodStart,
        periodEnd,
        currency,
        status: "PROCESSING",
      }));
    await ctx.scheduler.runAfter(0, internal.payouts.reserveBatch, {
      runId,
      cursor: null,
    });
    await ctx.scheduler.runAfter(0, internal.payouts.finishRuns, {});
  },
});

const UNSETTLED = ["RESERVED", "SENDING", "RETRY", "FAILED"] as const;

export const reserveBatch = internalMutation({
  args: { runId: v.id("payoutRuns"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { runId, cursor }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    const { minimumCents } = config();
    const now = Date.now();
    const page = await ctx.db
      .query("payoutAccounts")
      .paginate({ numItems: RESERVE_BATCH, cursor });
    for (const account of page.page) {
      if (account.transfersStatus !== "active") continue;
      const { creatorId } = account;
      const already = await ctx.db
        .query("payoutItems")
        .withIndex("by_run_creator", (q) =>
          q.eq("runId", runId).eq("creatorId", creatorId),
        )
        .first();
      if (already) continue;
      let unsettled = false;
      for (const status of UNSETTLED) {
        if (
          await ctx.db
            .query("payoutItems")
            .withIndex("by_creator_status", (q) =>
              q.eq("creatorId", creatorId).eq("status", status),
            )
            .first()
        ) {
          unsettled = true;
          break;
        }
      }
      if (unsettled) continue;
      const { availableCents } = await balanceAt(
        ctx,
        creatorId,
        run.currency,
        now,
      );
      if (availableCents < minimumCents) continue;

      const itemId = await ctx.db.insert("payoutItems", {
        runId,
        creatorId,
        amountCents: availableCents,
        currency: run.currency,
        destinationAccountId: account.stripeAccountId,
        idempotencyKey: `bling-payout-${creatorId}-${run.periodStart.slice(0, 7)}`,
        status: "RESERVED",
        attempts: 0,
        nextAttemptAt: now,
      });
      // The reservation takes the amount out of the available balance at
      // once, so nothing can be paid twice while the transfer is in flight.
      await postEntry(ctx, {
        creatorId,
        kind: "PAYOUT_RESERVATION",
        amountCents: -availableCents,
        currency: run.currency,
        effectiveAt: now,
        idempotencyKey: `payout-reservation:${itemId}`,
        payoutItemId: itemId,
      });
      if (run.status !== "PROCESSING") {
        await ctx.db.patch(runId, {
          status: "PROCESSING",
          completedAt: undefined,
        });
      }
      await ctx.scheduler.runAfter(0, internal.payouts.transfer, { itemId });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.payouts.reserveBatch, {
        runId,
        cursor: page.continueCursor,
      });
    }
  },
});

/** Sends one creator's transfer from Bling's balance to their account. */
export const transfer = internalAction({
  args: { itemId: v.id("payoutItems") },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.runMutation(internal.payouts.claimTransfer, {
      itemId,
    });
    if (!item) return;
    let transferId: string;
    try {
      const result = await stripeClient().transfers.create(
        {
          amount: item.amountCents,
          currency: item.currency,
          destination: item.destinationAccountId,
          metadata: { bling_payout_item_id: item._id },
        },
        { idempotencyKey: item.idempotencyKey },
      );
      transferId = result.id;
    } catch (error) {
      console.error("Creator transfer failed", (error as Error).message);
      await ctx.runMutation(internal.payouts.retryTransfer, {
        itemId,
        failureCode: "provider_error",
      });
      return;
    }
    await ctx.runMutation(internal.payouts.markPaid, { itemId, transferId });
  },
});

export const claimTransfer = internalMutation({
  args: { itemId: v.id("payoutItems") },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get(itemId);
    if (!item || item.attempts >= MAX_TRANSFER_ATTEMPTS) return null;
    const now = Date.now();
    const due =
      item.status === "RESERVED" ||
      ((item.status === "RETRY" || item.status === "SENDING") &&
        item.nextAttemptAt <= now);
    if (!due) return null;
    await ctx.db.patch(itemId, {
      status: "SENDING",
      attempts: item.attempts + 1,
      nextAttemptAt: now + TRANSFER_LEASE_MS,
    });
    return (await ctx.db.get(itemId))!;
  },
});

export const markPaid = internalMutation({
  args: { itemId: v.id("payoutItems"), transferId: v.string() },
  handler: async (ctx, { itemId, transferId }) => {
    const item = await ctx.db.get(itemId);
    if (item?.status !== "SENDING") return;
    await ctx.db.patch(itemId, {
      status: "PAID",
      stripeTransferId: transferId,
      failureCode: undefined,
      processedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.payouts.finishRuns, {});
  },
});

/**
 * Backs off exponentially. After MAX_TRANSFER_ATTEMPTS the item is FAILED
 * and its reservation stays in place: the money is neither lost nor sent
 * twice, and an operator settles it (the creator's later payouts wait).
 */
export const retryTransfer = internalMutation({
  args: { itemId: v.id("payoutItems"), failureCode: v.string() },
  handler: async (ctx, { itemId, failureCode }) => {
    const item = await ctx.db.get(itemId);
    if (item?.status !== "SENDING") return;
    const now = Date.now();
    if (item.attempts >= MAX_TRANSFER_ATTEMPTS) {
      await ctx.db.patch(itemId, {
        status: "FAILED",
        failureCode,
        processedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.payouts.finishRuns, {});
      return;
    }
    const delay = 1000 * 2 ** Math.min(item.attempts, 8);
    await ctx.db.patch(itemId, {
      status: "RETRY",
      failureCode,
      nextAttemptAt: now + delay,
    });
    await ctx.scheduler.runAfter(delay, internal.payouts.transfer, { itemId });
  },
});

/** Marks runs with nothing left in flight as COMPLETED or PARTIAL_FAILED. */
export const finishRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db
      .query("payoutRuns")
      .withIndex("by_status", (q) => q.eq("status", "PROCESSING"))
      .take(12);
    for (const run of runs) {
      const item = (status: Doc<"payoutItems">["status"]) =>
        ctx.db
          .query("payoutItems")
          .withIndex("by_run_status", (q) =>
            q.eq("runId", run._id).eq("status", status),
          )
          .first();
      if (
        (await item("RESERVED")) ||
        (await item("SENDING")) ||
        (await item("RETRY"))
      ) {
        continue;
      }
      await ctx.db.patch(run._id, {
        status: (await item("FAILED")) ? "PARTIAL_FAILED" : "COMPLETED",
        completedAt: Date.now(),
      });
    }
  },
});

/** Transfers whose action died, for the payments sweep. */
export const dueTransfers = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const ids: Id<"payoutItems">[] = [];
    for (const status of ["RESERVED", "RETRY", "SENDING"] as const) {
      const rows = await ctx.db
        .query("payoutItems")
        .withIndex("by_status_next", (q) =>
          q.eq("status", status).lte("nextAttemptAt", now),
        )
        .take(50);
      ids.push(
        ...rows
          .filter((row) => row.attempts < MAX_TRANSFER_ATTEMPTS)
          .map((row) => row._id),
      );
    }
    return ids;
  },
});
