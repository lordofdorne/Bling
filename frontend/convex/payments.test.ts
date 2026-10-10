import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { paymentFees } from "./lib/stripe";
import { expectCode, liveShow, type Participant, setup } from "./test.helpers";
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

beforeEach(() => {
  vi.useFakeTimers();
  stripe = createFakeStripe();
});
afterEach(() => vi.useRealTimers());

/** A live show with a $5 paid tier, and one caller. */
async function paidShow() {
  const env = setup();
  const host = await env.creator("alice");
  const { showId } = await liveShow(host);
  // Starting a paid show needs payout setup, so add the tier directly.
  const tierId = await env.t.run((ctx) =>
    ctx.db.insert("showTiers", {
      showId,
      name: "Priority",
      priorityRank: 300,
      callDurationSeconds: 120,
      priceCents: 500,
      enabled: true,
    }),
  );
  const caller = await env.viewer();
  const run = () => env.t.finishAllScheduledFunctions(vi.runAllTimers);
  const attempts = () =>
    env.t.run((ctx) => ctx.db.query("paymentAttempts").collect());
  const refunds = () =>
    env.t.run((ctx) => ctx.db.query("paymentRefunds").collect());
  return { ...env, host, showId, tierId, caller, run, attempts, refunds };
}

type PaidShow = Awaited<ReturnType<typeof paidShow>>;

/** The caller authorizes, confirms in the browser, and joins. */
async function authorizeAndJoin(
  env: PaidShow,
  caller: Participant = env.caller,
) {
  const authorization = await caller.client.action(api.payments.authorize, {
    showId: env.showId,
    tierId: env.tierId,
    idempotencyKey: `key-${caller.id}`,
  });
  const intentId = authorization.clientSecret.replace("_secret", "");
  stripe.confirm(intentId);
  const entry = await caller.client.action(api.queue.joinPaid, {
    showId: env.showId,
    tierId: env.tierId,
    displayName: "Sam",
    topic: "Pricing",
    paymentAttemptId: authorization.attemptId,
  });
  return { authorization, intentId, entry };
}

async function selectPaidCaller(env: PaidShow) {
  const joined = await authorizeAndJoin(env);
  const call = await env.host.client.mutation(api.calls.select, {
    showId: env.showId,
    entryId: joined.entry._id,
  });
  return { ...joined, call };
}

async function webhook(
  env: PaidShow,
  type: string,
  object: Record<string, unknown>,
  signature?: string,
) {
  const event = await stripe.signedEvent(type, object);
  return env.t.fetch("/stripe/webhook", {
    method: "POST",
    body: event.payload,
    headers: { "stripe-signature": signature ?? event.signature },
  });
}

describe("fees", () => {
  it.each([
    [50, 31, 15, 25],
    [500, 45, 22, 122],
    [999, 59, 29, 229],
    [5000, 175, 87, 1087],
    [1_000_000, 29030, 14515, 214515],
  ])("matches the Go API for %i cents", (amount, basic, creator, platform) => {
    // Expected values come from the Go formula (backend/internal/payment).
    expect(paymentFees(amount)).toEqual({
      platformFeeBps: 2000,
      basicCardFeeCents: basic,
      creatorProcessingFeeCents: creator,
      platformFeeCents: platform,
    });
  });
});

describe("authorizing a paid tier", () => {
  it("holds the tier price with a manual-capture PaymentIntent", async () => {
    const env = await paidShow();
    const { authorization, intentId } = await authorizeAndJoin(env);
    expect(authorization).toMatchObject({
      amountCents: 500,
      currency: "usd",
      publishableKey: "pk_test_fake",
    });
    expect(stripe.intents.get(intentId)).toMatchObject({
      amount: 500,
      capture_method: "manual",
      transfer_data: null,
    });
    expect(stripe.calls).toContainEqual({
      method: "paymentIntents.create",
      idempotencyKey: `bling-payment-create-${authorization.attemptId}`,
    });
    const [attempt] = await env.attempts();
    expect(attempt).toMatchObject({
      status: "AUTHORIZED",
      amountCents: 500,
      platformFeeCents: 122,
      payerId: env.caller.id,
    });
  });

  it("resumes the same attempt for a repeated key, only for its owner", async () => {
    const env = await paidShow();
    const request = {
      showId: env.showId,
      tierId: env.tierId,
      idempotencyKey: "same-key-1",
    };
    const first = await env.caller.client.action(
      api.payments.authorize,
      request,
    );
    const again = await env.caller.client.action(
      api.payments.authorize,
      request,
    );
    expect(again.attemptId).toBe(first.attemptId);
    expect(again.clientSecret).toBe(first.clientSecret);
    expect(await env.attempts()).toHaveLength(1);

    const stranger = await env.viewer();
    await expectCode(
      stranger.client.action(api.payments.authorize, request),
      "PAYMENT_NOT_AUTHORIZED",
    );
  });

  it("refuses free tiers and shows that are not live", async () => {
    const env = await paidShow();
    const [free] = await env.host.client
      .query(api.tiers.forLiveShow, { showId: env.showId })
      .then((tiers) => tiers.filter((tier) => tier.priceCents === 0));
    await expectCode(
      env.caller.client.action(api.payments.authorize, {
        showId: env.showId,
        tierId: free._id,
        idempotencyKey: "free-tier-1",
      }),
      "TIER_NOT_PAYABLE",
    );
    await env.host.client.mutation(api.shows.end, { showId: env.showId });
    await expectCode(
      env.caller.client.action(api.payments.authorize, {
        showId: env.showId,
        tierId: env.tierId,
        idempotencyKey: "ended-show-1",
      }),
      "SHOW_NOT_LIVE",
    );
  });

  it("gives signed-in callers a Stripe customer for saved cards", async () => {
    const env = await paidShow();
    const member = await env.creator("bob");
    const authorization = await member.client.action(api.payments.authorize, {
      showId: env.showId,
      tierId: env.tierId,
      idempotencyKey: "member-key-1",
    });
    expect(authorization.customerSessionClientSecret).toEqual(
      expect.any(String),
    );
    const [attempt] = await env.attempts();
    expect(attempt.stripeCustomerId).toMatch(/^cus_/);
  });
});

describe("joining a paid tier", () => {
  it("needs a hold Stripe has confirmed", async () => {
    const env = await paidShow();
    const authorization = await env.caller.client.action(
      api.payments.authorize,
      {
        showId: env.showId,
        tierId: env.tierId,
        idempotencyKey: "unconfirmed-1",
      },
    );
    const request = {
      showId: env.showId,
      tierId: env.tierId,
      displayName: "Sam",
      topic: "Pricing",
    };
    await expectCode(
      env.caller.client.action(api.queue.joinPaid, {
        ...request,
        paymentAttemptId: authorization.attemptId,
      }),
      "PAYMENT_NOT_AUTHORIZED",
    );
    await expectCode(
      env.caller.client.mutation(api.queue.join, request),
      "PAYMENT_REQUIRED",
    );
  });

  it("cannot use someone else's payment", async () => {
    const env = await paidShow();
    const { authorization } = await authorizeAndJoin(env);
    const stranger = await env.viewer();
    await expectCode(
      stranger.client.action(api.queue.joinPaid, {
        showId: env.showId,
        tierId: env.tierId,
        displayName: "Eve",
        topic: "Free ride",
        paymentAttemptId: authorization.attemptId,
      }),
      "PAYMENT_NOT_AUTHORIZED",
    );
  });

  it("releases the hold when the caller leaves", async () => {
    const env = await paidShow();
    const { intentId } = await authorizeAndJoin(env);
    await env.caller.client.mutation(api.queue.leave, { showId: env.showId });
    await env.run();
    expect(stripe.intents.get(intentId)?.status).toBe("canceled");
    expect((await env.attempts())[0].status).toBe("CANCELED");
  });

  it("releases waiting callers' holds when the show ends", async () => {
    const env = await paidShow();
    const { intentId } = await authorizeAndJoin(env);
    await env.host.client.mutation(api.shows.end, { showId: env.showId });
    await env.run();
    expect(stripe.intents.get(intentId)?.status).toBe("canceled");
  });
});

describe("capturing when the creator picks a paid caller", () => {
  it("opens the call once Stripe captures the payment", async () => {
    const env = await paidShow();
    const { call, intentId } = await selectPaidCaller(env);
    expect(call.status).toBe("PAYMENT_PENDING");
    // The caller does not see a call until it is paid for.
    expect(
      await env.caller.client.query(api.calls.mine, { showId: env.showId }),
    ).toBeNull();

    await env.run();
    expect(stripe.intents.get(intentId)?.status).toBe("succeeded");
    expect(stripe.calls).toContainEqual({
      method: "paymentIntents.capture",
      idempotencyKey: `bling-payment-capture-${call._id}`,
    });
    expect(
      await env.caller.client.query(api.calls.mine, { showId: env.showId }),
    ).toMatchObject({ status: "CREATED" });
    expect((await env.attempts())[0].status).toBe("CAPTURED");
  });

  it("retries a capture that hit a network error", async () => {
    const env = await paidShow();
    stripe.failures.capture.push(stripe.transient(), stripe.transient());
    await selectPaidCaller(env);
    await env.run();
    expect(
      stripe.calls.filter((call) => call.method === "paymentIntents.capture"),
    ).toHaveLength(3);
    expect((await env.attempts())[0].status).toBe("CAPTURED");
  });

  it("fails the call and frees the caller when the card is declined", async () => {
    const env = await paidShow();
    stripe.failures.capture.push(stripe.declined());
    const { intentId, entry } = await selectPaidCaller(env);
    await env.run();
    expect(stripe.intents.get(intentId)?.status).toBe("canceled");
    expect((await env.attempts())[0]).toMatchObject({
      status: "FAILED",
      failureCode: "capture_failed",
    });
    expect(
      await env.host.client.query(api.calls.active, { showId: env.showId }),
    ).toBeNull();
    expect(
      await env.caller.client.query(api.queue.mine, { showId: env.showId }),
    ).toMatchObject({ _id: entry._id, status: "LEFT" });
  });

  it("refunds a capture that lands after the show ended", async () => {
    const env = await paidShow();
    const { call } = await selectPaidCaller(env);
    await env.host.client.mutation(api.shows.end, { showId: env.showId });
    await env.run();
    const [refund] = await env.refunds();
    expect(refund).toMatchObject({
      callId: call._id,
      reason: "show_ended_before_call_started",
      status: "SUCCEEDED",
    });
  });
});

describe("refunds", () => {
  async function capturedCall() {
    const env = await paidShow();
    const selected = await selectPaidCaller(env);
    await env.run();
    return { env, ...selected };
  }

  it("refunds a paid call that ends before going live", async () => {
    const { env, call } = await capturedCall();
    await env.host.client.mutation(api.calls.transition, {
      callId: call._id,
      status: "ENDED",
    });
    await env.run();
    const [refund] = await env.refunds();
    expect(refund).toMatchObject({
      reason: "call_ended_before_live",
      status: "SUCCEEDED",
      attempts: 1,
    });
    expect(stripe.calls).toContainEqual({
      method: "refunds.create",
      idempotencyKey: `bling-refund-${refund._id}`,
    });
  });

  it("does not refund a call that went live", async () => {
    const { env, call } = await capturedCall();
    await env.host.client.mutation(api.calls.transition, {
      callId: call._id,
      status: "CONNECTING",
    });
    await env.caller.client.mutation(api.calls.transition, {
      callId: call._id,
      status: "LIVE",
    });
    await env.host.client.mutation(api.calls.transition, {
      callId: call._id,
      status: "ENDED",
    });
    await env.run();
    expect(await env.refunds()).toEqual([]);
  });

  it("retries with backoff after Stripe errors", async () => {
    const { env, call } = await capturedCall();
    stripe.failures.refund.push(stripe.transient(), stripe.transient());
    await env.host.client.mutation(api.calls.transition, {
      callId: call._id,
      status: "FAILED",
    });
    await env.run();
    const [refund] = await env.refunds();
    expect(refund).toMatchObject({
      reason: "call_failed_before_live",
      status: "SUCCEEDED",
      attempts: 3,
    });
  });

  it("checks a pending refund again rather than creating another", async () => {
    const { env, call } = await capturedCall();
    stripe.failures.refundStatus = "pending";
    await env.host.client.mutation(api.calls.transition, {
      callId: call._id,
      status: "ENDED",
    });
    await env.t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(0);
    await env.t.finishInProgressScheduledFunctions();
    expect((await env.refunds())[0].status).toBe("PENDING");

    vi.advanceTimersByTime(5 * 60_000);
    await env.t.finishInProgressScheduledFunctions();
    expect(
      stripe.calls.filter((c) => c.method === "refunds.create"),
    ).toHaveLength(1);
    expect(
      stripe.calls.filter((c) => c.method === "refunds.retrieve"),
    ).toHaveLength(1);
  });
});

describe("Stripe webhook", () => {
  it("rejects unsigned requests", async () => {
    const env = await paidShow();
    const response = await webhook(
      env,
      "payment_intent.succeeded",
      { id: "pi_x" },
      "t=1,v1=forged",
    );
    expect(response.status).toBe(400);
  });

  it("opens a paid call when Stripe reports the capture first, once", async () => {
    const env = await paidShow();
    stripe.failures.capture.push(stripe.transient());
    const { call, intentId } = await selectPaidCaller(env);
    // The capture action has not finished; the webhook arrives first.
    const event = await stripe.signedEvent("payment_intent.succeeded", {
      id: intentId,
      object: "payment_intent",
    });
    for (let delivery = 0; delivery < 2; delivery++) {
      const response = await env.t.fetch("/stripe/webhook", {
        method: "POST",
        body: event.payload,
        headers: { "stripe-signature": event.signature },
      });
      expect(response.status).toBe(204);
    }
    expect(
      await env.host.client.query(api.calls.active, { showId: env.showId }),
    ).toMatchObject({ _id: call._id, status: "CREATED" });
    expect(
      await env.t.run((ctx) => ctx.db.query("stripeEvents").collect()),
    ).toHaveLength(1);
  });

  it("releases the caller when Stripe reports the payment canceled", async () => {
    const env = await paidShow();
    const { intentId, entry } = await authorizeAndJoin(env);
    await webhook(env, "payment_intent.canceled", {
      id: intentId,
      object: "payment_intent",
    });
    expect((await env.attempts())[0].status).toBe("CANCELED");
    expect(
      await env.caller.client.query(api.queue.mine, { showId: env.showId }),
    ).toMatchObject({ _id: entry._id, status: "LEFT" });
  });

  it("records refund outcomes and disputes, shown in the creator's activity", async () => {
    const env = await paidShow();
    const { call, intentId } = await selectPaidCaller(env);
    stripe.failures.refundStatus = "pending";
    await env.run();
    await env.host.client.mutation(api.calls.transition, {
      callId: call._id,
      status: "ENDED",
    });
    await env.t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(0);
    await env.t.finishInProgressScheduledFunctions();
    const [pending] = await env.refunds();

    await webhook(env, "refund.updated", {
      id: pending.stripeRefundId,
      object: "refund",
      payment_intent: intentId,
      status: "succeeded",
    });
    await webhook(env, "charge.dispute.created", {
      id: "dp_1",
      object: "dispute",
      payment_intent: intentId,
      amount: 500,
      currency: "usd",
      reason: "fraudulent",
      status: "needs_response",
      evidence_details: { due_by: 1_800_000_000 },
    });

    const [activity] = await env.host.client.query(api.payments.activity, {});
    expect(activity).toMatchObject({
      amountCents: 500,
      platformFeeCents: 122,
      paymentStatus: "CAPTURED",
      refundStatus: "SUCCEEDED",
      refundReason: "call_ended_before_live",
      disputeStatus: "needs_response",
      disputeReason: "fraudulent",
    });
  });
});

describe("saved cards", () => {
  it("lists, adds and removes only the user's own cards", async () => {
    const { creator } = setup();
    const member = await creator("bob");
    expect(await member.client.action(api.paymentMethods.list, {})).toEqual([]);

    const setupResult = await member.client.action(
      api.paymentMethods.setup,
      {},
    );
    expect(setupResult.publishableKey).toBe("pk_test_fake");
    await member.client.action(api.paymentMethods.setup, {});
    expect(
      stripe.calls.filter((call) => call.method === "customers.create"),
    ).toHaveLength(1);

    const own = stripe.addSavedCard("cus_1");
    const someoneElses = stripe.addSavedCard("cus_other");
    expect(await member.client.action(api.paymentMethods.list, {})).toEqual([
      {
        id: own,
        type: "card",
        brand: "visa",
        last4: "4242",
        expMonth: 12,
        expYear: 2030,
      },
    ]);
    await expectCode(
      member.client.action(api.paymentMethods.remove, {
        paymentMethodId: someoneElses,
      }),
      "PAYMENT_METHOD_NOT_FOUND",
    );
    await member.client.action(api.paymentMethods.remove, {
      paymentMethodId: own,
    });
    expect(await member.client.action(api.paymentMethods.list, {})).toEqual([]);
  });

  it("is only for signed-in accounts", async () => {
    const { viewer } = setup();
    const caller = await viewer();
    await expectCode(
      caller.client.action(api.paymentMethods.list, {}),
      "UNAUTHENTICATED",
    );
  });
});
