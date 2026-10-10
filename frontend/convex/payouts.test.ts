import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { postEntry } from "./lib/ledger";
import { payoutPeriod, projectAccount } from "./payouts";
import { expectCode, free, type Participant, setup } from "./test.helpers";
import {
  createFakeStripe,
  type FakeStripe,
  CONNECT_WEBHOOK_SECRET,
  WEBHOOK_SECRET,
} from "./test.stripe";

let stripe: FakeStripe;

vi.mock("./lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/stripe")>()),
  stripeClient: () => stripe.client,
  publishableKey: () => "pk_test_fake",
  webhookSecrets: () => [WEBHOOK_SECRET, CONNECT_WEBHOOK_SECRET],
}));

const HOUR = 60 * 60_000;
const OCT_9 = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(OCT_9);
  stripe = createFakeStripe();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function onboardedCreator(
  env: ReturnType<typeof setup>,
  username = "alice",
) {
  const host = await env.creator(username);
  await host.client.action(api.payouts.accountSession, {});
  const [account] = [...stripe.accounts.values()].slice(-1);
  stripe.completeOnboarding(account.id);
  await host.client.action(api.payouts.status, {});
  return { host, accountId: account.id };
}

/** A paid call that has gone live, so the creator has earned from it. */
async function liveCall(env: ReturnType<typeof setup>, host: Participant) {
  const showId = await host.client.mutation(api.shows.create, {});
  await host.client.mutation(api.tiers.replace, {
    showId,
    tiers: [{ ...free("Priority"), priceCents: 500 }],
  });
  await host.client.mutation(api.shows.start, { showId });
  const [tier] = await host.client.query(api.tiers.forCreator, { showId });
  const caller = await env.viewer();
  const auth = await caller.client.action(api.payments.authorize, {
    showId,
    tierId: tier._id,
    idempotencyKey: `key-${caller.id}`,
  });
  stripe.confirm(auth.clientSecret.replace("_secret", ""));
  const entry = await caller.client.action(api.queue.joinPaid, {
    showId,
    tierId: tier._id,
    displayName: "Sam",
    topic: "Hi",
    paymentAttemptId: auth.attemptId,
  });
  const call = await host.client.mutation(api.calls.select, {
    showId,
    entryId: entry._id,
  });
  await env.t.finishAllScheduledFunctions(vi.runAllTimers);
  await host.client.mutation(api.calls.transition, {
    callId: call._id,
    status: "CONNECTING",
  });
  await caller.client.mutation(api.calls.transition, {
    callId: call._id,
    status: "LIVE",
  });
  return {
    showId,
    callId: call._id,
    attemptId: auth.attemptId,
    liveAt: Date.now(),
  };
}

const ledger = (env: ReturnType<typeof setup>) =>
  env.t.run((ctx) => ctx.db.query("ledgerEntries").collect());

async function credit(
  env: ReturnType<typeof setup>,
  creatorId: Id<"users">,
  cents: number,
) {
  await env.t.run((ctx) =>
    postEntry(ctx as unknown as MutationCtx, {
      creatorId,
      kind: "ADJUSTMENT",
      amountCents: cents,
      currency: "usd",
      effectiveAt: Date.now() - HOUR,
      idempotencyKey: `adjust-${creatorId}-${cents}-${Math.random()}`,
    }),
  );
}

describe("reading a Stripe account", () => {
  const account = (entries: unknown[], status = "active") =>
    ({
      id: "acct_1",
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { status },
              payouts: { status },
            },
          },
        },
      },
      requirements: { entries },
    }) as unknown as Stripe.V2.Core.Account;
  const bank = (fields: Record<string, unknown>) =>
    ({
      status: "new",
      bank_name: "BANK",
      last4: "0000",
      currency: "usd",
      default_for_currency: false,
      ...fields,
    }) as unknown as Stripe.BankAccount;

  it("is held back only by requirements due now", () => {
    const due = (status?: string, from = "user") => ({
      awaiting_action_from: from,
      description: `${status} item`,
      minimum_deadline: status ? { status } : undefined,
    });
    expect(
      projectAccount(account([due("eventually_due")]), []).detailsSubmitted,
    ).toBe(true);
    expect(
      projectAccount(account([due("currently_due")]), []).detailsSubmitted,
    ).toBe(false);
    expect(
      projectAccount(account([due("past_due")]), []).detailsSubmitted,
    ).toBe(false);
    // Unknown urgency fails closed; Stripe's own work never blocks.
    expect(projectAccount(account([due(undefined)]), []).detailsSubmitted).toBe(
      false,
    );
    expect(
      projectAccount(account([due("currently_due", "stripe")]), [])
        .detailsSubmitted,
    ).toBe(true);
  });

  it("uses the default bank account and ignores broken ones", () => {
    const projected = projectAccount(account([]), [
      bank({ last4: "1111", status: "errored", default_for_currency: true }),
      bank({ last4: "2222" }),
      bank({ last4: "3333", default_for_currency: true }),
    ]);
    expect(projected).toMatchObject({
      externalAccountPresent: true,
      externalAccountLast4: "3333",
    });
    expect(
      projectAccount(account([]), [bank({ status: "verification_failed" })])
        .externalAccountPresent,
    ).toBe(false);
  });
});

describe("payout setup", () => {
  it("creates one recipient account and reports readiness from Stripe", async () => {
    const env = setup();
    const host = await env.creator("alice");
    expect(await host.client.action(api.payouts.status, {})).toMatchObject({
      connected: false,
      ready: false,
    });

    const session = await host.client.action(api.payouts.accountSession, {});
    expect(session).toMatchObject({
      clientSecret: expect.any(String),
      publishableKey: "pk_test_fake",
    });
    await host.client.action(api.payouts.accountSession, {});
    const creates = stripe.calls.filter(
      (call) => call.method === "v2.core.accounts.create",
    );
    expect(creates).toHaveLength(1);
    expect(creates[0].idempotencyKey).toBe(
      `bling-connect-account-v2-${host.id}`,
    );
    expect(await host.client.action(api.payouts.status, {})).toMatchObject({
      connected: true,
      ready: false,
      requirementsDue: ["Provide your bank account"],
    });

    const [account] = [...stripe.accounts.values()];
    stripe.completeOnboarding(account.id);
    expect(await host.client.action(api.payouts.status, {})).toMatchObject({
      ready: true,
      externalAccountLast4: "6789",
      platformFeePercent: 20,
      creatorProcessingFeePercent: 50,
    });
    expect(await host.client.query(api.payouts.current, {})).toMatchObject({
      ready: true,
    });
  });

  it("lets a paid show start only once the creator can be paid", async () => {
    const env = setup();
    const host = await env.creator("alice");
    const showId = await host.client.mutation(api.shows.create, {});
    await host.client.mutation(api.tiers.replace, {
      showId,
      tiers: [{ ...free("Priority"), priceCents: 500 }],
    });
    await expectCode(
      host.client.mutation(api.shows.start, { showId }),
      "PAYOUT_SETUP_REQUIRED",
    );
    await host.client.action(api.payouts.accountSession, {});
    await expectCode(
      host.client.mutation(api.shows.start, { showId }),
      "PAYOUT_SETUP_REQUIRED",
    );
    const [account] = [...stripe.accounts.values()];
    stripe.completeOnboarding(account.id);
    await host.client.action(api.payouts.status, {});
    expect(
      await host.client.mutation(api.shows.start, { showId }),
    ).toMatchObject({ status: "LIVE" });
  });

  it("refreshes readiness when Stripe sends account.updated", async () => {
    const env = setup();
    const host = await env.creator("alice");
    await host.client.action(api.payouts.accountSession, {});
    const [account] = [...stripe.accounts.values()];
    stripe.completeOnboarding(account.id);
    const event = await stripe.signedEvent("account.updated", {
      id: account.id,
      object: "account",
    });
    await env.t.fetch("/stripe/webhook", {
      method: "POST",
      body: event.payload,
      headers: { "stripe-signature": event.signature },
    });
    await env.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await host.client.query(api.payouts.current, {})).toMatchObject({
      ready: true,
    });
  });

  it("reports a failed bank payout until a later one is paid", async () => {
    const env = setup();
    const { host, accountId } = await onboardedCreator(env);
    const send = async (id: string, status: string) => {
      const event = await stripe.signedEvent(
        `payout.${status === "paid" ? "paid" : "failed"}`,
        {
          id,
          object: "payout",
          amount: 3000,
          currency: "usd",
          status,
          failure_code: status === "failed" ? "account_closed" : null,
          failure_message:
            status === "failed" ? "The bank account has been closed" : null,
          arrival_date: 1_800_000_000,
        },
      );
      const signed = JSON.parse(event.payload);
      signed.account = accountId;
      const payload = JSON.stringify(signed);
      const signature =
        await stripe.client.webhooks.generateTestHeaderStringAsync({
          payload,
          secret: CONNECT_WEBHOOK_SECRET,
        });
      await env.t.fetch("/stripe/webhook", {
        method: "POST",
        body: payload,
        headers: { "stripe-signature": signature },
      });
    };
    await send("po_1", "failed");
    expect(
      await host.client.query(api.payouts.latestFailure, {}),
    ).toMatchObject({ payoutId: "po_1", failureCode: "account_closed" });
    vi.advanceTimersByTime(1000);
    await send("po_2", "paid");
    expect(await host.client.query(api.payouts.latestFailure, {})).toBeNull();
  });
});

describe("the ledger", () => {
  it("credits the creator's share, held for a week, when a paid call goes live", async () => {
    const env = setup();
    const { host } = await onboardedCreator(env);
    const { liveAt } = await liveCall(env, host);
    const [earning] = await ledger(env);
    // $5.00 less Bling's $1.22 (20% plus half the card fee).
    expect(earning).toMatchObject({
      kind: "EARNING",
      amountCents: 378,
      effectiveAt: liveAt + 168 * HOUR,
    });
    expect(
      (await host.client.query(api.payouts.balance, {})).balance,
    ).toMatchObject({
      totalCents: 378,
      pendingCents: 378,
      availableCents: 0,
    });
    vi.advanceTimersByTime(168 * HOUR);
    expect(
      (await host.client.query(api.payouts.balance, {})).balance,
    ).toMatchObject({
      totalCents: 378,
      pendingCents: 0,
      availableCents: 378,
    });
  });

  it("credits a call only once however often it is reported live", async () => {
    const env = setup();
    const { host } = await onboardedCreator(env);
    const { callId } = await liveCall(env, host);
    await host.client.mutation(api.calls.transition, {
      callId,
      status: "LIVE",
    });
    expect(await ledger(env)).toHaveLength(1);
  });

  it("holds back the share during a dispute and releases it if Bling wins", async () => {
    const env = setup();
    const { host } = await onboardedCreator(env);
    const { attemptId } = await liveCall(env, host);
    const intentId = (await env.t.run((ctx) => ctx.db.get(attemptId)))!
      .stripePaymentIntentId!;
    const dispute = async (status: string) => {
      const event = await stripe.signedEvent("charge.dispute.updated", {
        id: "dp_1",
        object: "dispute",
        payment_intent: intentId,
        amount: 500,
        currency: "usd",
        reason: "fraudulent",
        status,
      });
      await env.t.fetch("/stripe/webhook", {
        method: "POST",
        body: event.payload,
        headers: { "stripe-signature": event.signature },
      });
    };
    await dispute("needs_response");
    await dispute("under_review");
    expect(
      (await ledger(env)).map((entry) => [entry.kind, entry.amountCents]),
    ).toEqual([
      ["EARNING", 378],
      ["DISPUTE_DEBIT", -378],
    ]);
    await dispute("won");
    await dispute("won");
    expect(
      (await host.client.query(api.payouts.balance, {})).balance.totalCents,
    ).toBe(378);
    expect((await ledger(env)).map((entry) => entry.kind)).toEqual([
      "EARNING",
      "DISPUTE_DEBIT",
      "DISPUTE_RELEASE",
    ]);
  });

  it("takes back the share when a refund of a live call succeeds", async () => {
    const env = setup();
    const { host } = await onboardedCreator(env);
    const { attemptId, callId } = await liveCall(env, host);
    const attempt = (await env.t.run((ctx) => ctx.db.get(attemptId)))!;
    // An operator refund recorded for the call.
    await env.t.run((ctx) =>
      ctx.db.insert("paymentRefunds", {
        paymentAttemptId: attemptId,
        callId,
        stripePaymentIntentId: attempt.stripePaymentIntentId!,
        stripeRefundId: "re_manual",
        amountCents: 500,
        currency: "usd",
        reason: "support",
        status: "PENDING",
        attempts: 1,
        nextAttemptAt: Date.now() + HOUR,
      }),
    );
    const event = await stripe.signedEvent("refund.updated", {
      id: "re_manual",
      object: "refund",
      payment_intent: attempt.stripePaymentIntentId,
      status: "succeeded",
    });
    await env.t.fetch("/stripe/webhook", {
      method: "POST",
      body: event.payload,
      headers: { "stripe-signature": event.signature },
    });
    expect(
      (await host.client.query(api.payouts.balance, {})).balance.totalCents,
    ).toBe(0);
  });

  async function dashboardRefund(
    env: ReturnType<typeof setup>,
    intentId: string,
    id: string,
    amount: number,
  ) {
    const event = await stripe.signedEvent("refund.created", {
      id,
      object: "refund",
      payment_intent: intentId,
      amount,
      currency: "usd",
      status: "succeeded",
    });
    await env.t.fetch("/stripe/webhook", {
      method: "POST",
      body: event.payload,
      headers: { "stripe-signature": event.signature },
    });
  }

  it("reverses the share when support refunds in the Stripe dashboard", async () => {
    const env = setup();
    const { host } = await onboardedCreator(env);
    const { attemptId } = await liveCall(env, host);
    const attempt = (await env.t.run((ctx) => ctx.db.get(attemptId)))!;
    await dashboardRefund(env, attempt.stripePaymentIntentId!, "re_dash", 500);

    expect(
      (await host.client.query(api.payouts.balance, {})).balance.totalCents,
    ).toBe(0);
    const refunds = await env.t.run((ctx) =>
      ctx.db.query("paymentRefunds").collect(),
    );
    expect(refunds).toMatchObject([
      {
        stripeRefundId: "re_dash",
        status: "SUCCEEDED",
        reason: "OUTSIDE_BLING",
      },
    ]);
  });

  it("reverses part of the share for a partial refund, never more than earned", async () => {
    const env = setup();
    const { host } = await onboardedCreator(env);
    const { attemptId } = await liveCall(env, host);
    const intent = (await env.t.run((ctx) => ctx.db.get(attemptId)))!
      .stripePaymentIntentId!;
    const balance = async () =>
      (await host.client.query(api.payouts.balance, {})).balance.totalCents;

    // $2.50 of $5.00 takes back half of the $3.78 share.
    await dashboardRefund(env, intent, "re_half", 250);
    expect(await balance()).toBe(189);
    // Redelivery changes nothing.
    await dashboardRefund(env, intent, "re_half", 250);
    expect(await balance()).toBe(189);
    await dashboardRefund(env, intent, "re_rest", 250);
    expect(await balance()).toBe(0);
    await dashboardRefund(env, intent, "re_extra", 100);
    expect(await balance()).toBe(0);
  });
});

describe("earnings chart", () => {
  it("totals net earnings per day, by when they were earned", async () => {
    const env = setup();
    const { host } = await onboardedCreator(env);
    const { attemptId } = await liveCall(env, host);
    const intent = (await env.t.run((ctx) => ctx.db.get(attemptId)))!
      .stripePaymentIntentId!;
    // Two days later, support refunds half of it.
    vi.advanceTimersByTime(48 * HOUR);
    const event = await stripe.signedEvent("refund.created", {
      id: "re_half",
      object: "refund",
      payment_intent: intent,
      amount: 250,
      currency: "usd",
      status: "succeeded",
    });
    await env.t.fetch("/stripe/webhook", {
      method: "POST",
      body: event.payload,
      headers: { "stripe-signature": event.signature },
    });

    expect(await host.client.query(api.payouts.earnings, { days: 30 })).toEqual(
      {
        currency: "usd",
        days: [
          { date: "2026-10-09", cents: 378 },
          { date: "2026-10-11", cents: -189 },
        ],
      },
    );
    // A window that starts after the call leaves the earning out.
    expect(
      (await host.client.query(api.payouts.earnings, { days: 1 })).days,
    ).toEqual([{ date: "2026-10-11", cents: -189 }]);
    // Activity lists the refund first: it happened later, though the
    // earning clears later still.
    expect(
      (await host.client.query(api.payouts.balance, {})).activity.map(
        (entry) => entry.kind,
      ),
    ).toEqual(["REFUND_REVERSAL", "EARNING"]);
  });
});

describe("monthly payout run", () => {
  it("works out the period being paid", () => {
    expect(payoutPeriod(OCT_9, 1)).toEqual({
      periodStart: "2026-09-01",
      periodEnd: "2026-10-01",
    });
    expect(payoutPeriod(OCT_9, 15)).toEqual({
      periodStart: "2026-08-01",
      periodEnd: "2026-09-01",
    });
    expect(payoutPeriod(Date.UTC(2027, 0, 5), 10)).toEqual({
      periodStart: "2026-11-01",
      periodEnd: "2026-12-01",
    });
  });

  async function payoutEnv() {
    vi.stubEnv("CREATOR_PAYOUTS_ENABLED", "true");
    const env = setup();
    const { host, accountId } = await onboardedCreator(env);
    const run = async () => {
      await env.t.mutation(internal.payouts.runDue, {});
      await env.t.finishAllScheduledFunctions(vi.runAllTimers);
    };
    const items = () =>
      env.t.run((ctx) => ctx.db.query("payoutItems").collect());
    const runs = () => env.t.run((ctx) => ctx.db.query("payoutRuns").collect());
    return { env, host, accountId, run, items, runs };
  }

  it("reserves the available balance and transfers it once", async () => {
    const { env, host, accountId, run, items, runs } = await payoutEnv();
    await credit(env, host.id, 3000);
    await run();
    expect(stripe.transfers).toEqual([
      {
        id: expect.any(String),
        amount: 3000,
        currency: "usd",
        destination: accountId,
        metadata: expect.any(Object),
        idempotencyKey: `bling-payout-${host.id}-2026-09`,
      },
    ]);
    expect(await items()).toMatchObject([
      { status: "PAID", amountCents: 3000 },
    ]);
    expect(await runs()).toMatchObject([
      { periodStart: "2026-09-01", status: "COMPLETED" },
    ]);
    expect(
      (await host.client.query(api.payouts.balance, {})).balance,
    ).toMatchObject({ totalCents: 0, availableCents: 0 });

    // Later the same month: more earnings wait for next month's run.
    await credit(env, host.id, 4000);
    await run();
    expect(stripe.transfers).toHaveLength(1);
  });

  it("skips balances under the minimum, held earnings, and disabled payouts", async () => {
    const { env, host, run, items } = await payoutEnv();
    await credit(env, host.id, 2499);
    await run();
    expect(await items()).toEqual([]);

    await env.t.run((ctx) =>
      postEntry(ctx as unknown as MutationCtx, {
        creatorId: host.id,
        kind: "ADJUSTMENT",
        amountCents: 5000,
        currency: "usd",
        effectiveAt: Date.now() + HOUR,
        idempotencyKey: "held",
      }),
    );
    await run();
    expect(await items()).toEqual([]);

    vi.stubEnv("CREATOR_PAYOUTS_ENABLED", "false");
    vi.advanceTimersByTime(2 * HOUR);
    await run();
    expect(await items()).toEqual([]);
  });

  it("retries a transfer after Stripe errors", async () => {
    const { env, host, run, items } = await payoutEnv();
    stripe.failures.transfer.push(stripe.transient(), stripe.transient());
    await credit(env, host.id, 3000);
    await run();
    expect(await items()).toMatchObject([{ status: "PAID", attempts: 3 }]);
  });

  it("keeps the money reserved and stops paying a creator whose transfer keeps failing", async () => {
    const { env, host, run, items, runs } = await payoutEnv();
    stripe.failures.transfer.push(
      ...Array.from({ length: 10 }, () => stripe.declined()),
    );
    await credit(env, host.id, 3000);
    await run();
    expect(await items()).toMatchObject([{ status: "FAILED", attempts: 10 }]);
    expect(await runs()).toMatchObject([{ status: "PARTIAL_FAILED" }]);
    expect(
      (await host.client.query(api.payouts.balance, {})).balance.totalCents,
    ).toBe(0);

    // Next month the creator waits until an operator settles the failure.
    vi.setSystemTime(Date.UTC(2026, 10, 2));
    await credit(env, host.id, 3000);
    await run();
    expect(await items()).toHaveLength(1);
  });

  it("pays every eligible creator", async () => {
    const { env, host, run, items } = await payoutEnv();
    const second = await onboardedCreator(env, "bob");
    const unready = await env.creator("carol");
    await credit(env, host.id, 3000);
    await credit(env, second.host.id, 5000);
    await credit(env, unready.id, 9000);
    await run();
    expect((await items()).map((item) => item.amountCents).sort()).toEqual([
      3000, 5000,
    ]);
  });
});
