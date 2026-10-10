import Stripe from "stripe";

// An in-memory stand-in for the parts of Stripe Bling uses, for convex-test
// suites (vi.mock("./lib/stripe") returns it). Webhook signing and checking
// use Stripe's real code, so signature handling is tested for real.
// Convex does not deploy files with more than one dot in their name.

export const WEBHOOK_SECRET = "whsec_test_secret";

type Intent = {
  id: string;
  client_secret: string;
  amount: number;
  currency: string;
  status: string;
  capture_method: string;
  customer?: string;
  transfer_data: null;
  application_fee_amount: null;
  metadata: Record<string, string>;
};

class FakeError extends Error {
  constructor(
    message: string,
    readonly type: string,
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

export function createFakeStripe() {
  let sequence = 0;
  const next = (prefix: string) => `${prefix}_${++sequence}`;
  const intents = new Map<string, Intent>();
  const refunds = new Map<string, { id: string; status: string }>();
  const customers: { id: string; email: string; idempotencyKey?: string }[] =
    [];
  const methods = new Map<string, { customer: string }>();
  const accounts = new Map<string, ConnectedAccount>();
  const transfers: {
    id: string;
    amount: number;
    destination: string;
    idempotencyKey?: string;
  }[] = [];
  const calls: { method: string; idempotencyKey?: string }[] = [];
  const failures = {
    /** Errors thrown by the next transfer calls, in order. */
    transfer: [] as FakeError[],
    /** Errors thrown by the next capture calls, in order. */
    capture: [] as FakeError[],
    /** Errors thrown by the next refund calls, in order. */
    refund: [] as FakeError[],
    /** Status the next created refund reports. */
    refundStatus: "succeeded",
  };

  const record = (method: string, options?: { idempotencyKey?: string }) =>
    calls.push({ method, idempotencyKey: options?.idempotencyKey });
  const intent = (id: string) => {
    const value = intents.get(id);
    if (!value)
      throw new FakeError("No such intent", "StripeInvalidRequestError", 404);
    return value;
  };

  const client = {
    paymentIntents: {
      async create(
        params: {
          amount: number;
          currency: string;
          capture_method: string;
          customer?: string;
          metadata: Record<string, string>;
        },
        options?: { idempotencyKey?: string },
      ) {
        record("paymentIntents.create", options);
        const existing = [...intents.values()].find(
          (value) => value.metadata.idempotencyKey === options?.idempotencyKey,
        );
        if (existing) return existing;
        const id = next("pi");
        const value: Intent = {
          id,
          client_secret: `${id}_secret`,
          amount: params.amount,
          currency: params.currency,
          capture_method: params.capture_method,
          customer: params.customer,
          status: "requires_payment_method",
          transfer_data: null,
          application_fee_amount: null,
          metadata: {
            ...params.metadata,
            idempotencyKey: options?.idempotencyKey ?? "",
          },
        };
        intents.set(id, value);
        return value;
      },
      async retrieve(id: string) {
        record("paymentIntents.retrieve");
        return intent(id);
      },
      async capture(
        id: string,
        _params: unknown,
        options?: { idempotencyKey?: string },
      ) {
        record("paymentIntents.capture", options);
        const error = failures.capture.shift();
        if (error) throw error;
        const value = intent(id);
        if (
          value.status !== "requires_capture" &&
          value.status !== "succeeded"
        ) {
          throw new FakeError(
            "Cannot capture",
            "StripeInvalidRequestError",
            400,
          );
        }
        value.status = "succeeded";
        return value;
      },
      async cancel(
        id: string,
        _params: unknown,
        options?: { idempotencyKey?: string },
      ) {
        record("paymentIntents.cancel", options);
        const value = intent(id);
        if (value.status === "succeeded") {
          throw new FakeError(
            "Already captured",
            "StripeInvalidRequestError",
            400,
          );
        }
        value.status = "canceled";
        return value;
      },
    },
    refunds: {
      async create(
        params: { payment_intent: string },
        options?: { idempotencyKey?: string },
      ) {
        record("refunds.create", options);
        const error = failures.refund.shift();
        if (error) throw error;
        const id = next("re");
        const value = {
          id,
          status: failures.refundStatus,
          payment_intent: params.payment_intent,
          failure_reason: null,
        };
        refunds.set(id, value);
        return value;
      },
      async retrieve(id: string) {
        record("refunds.retrieve");
        return { failure_reason: null, ...refunds.get(id)! };
      },
    },
    customers: {
      async create(
        params: { email: string },
        options?: { idempotencyKey?: string },
      ) {
        record("customers.create", options);
        const existing = customers.find(
          (value) => value.idempotencyKey === options?.idempotencyKey,
        );
        if (existing) return existing;
        const value = {
          id: next("cus"),
          email: params.email,
          idempotencyKey: options?.idempotencyKey,
        };
        customers.push(value);
        return value;
      },
    },
    customerSessions: {
      async create() {
        record("customerSessions.create");
        return { client_secret: next("cuss_secret") };
      },
    },
    setupIntents: {
      async create() {
        record("setupIntents.create");
        return { client_secret: next("seti_secret") };
      },
    },
    paymentMethods: {
      async list(params: { customer: string }) {
        record("paymentMethods.list");
        return {
          data: [...methods]
            .filter(([, value]) => value.customer === params.customer)
            .map(([id]) => ({
              id,
              allow_redisplay: "always",
              card: {
                brand: "visa",
                last4: "4242",
                exp_month: 12,
                exp_year: 2030,
              },
            })),
        };
      },
      async detach(id: string) {
        record("paymentMethods.detach");
        methods.delete(id);
        return { id };
      },
    },
    v2: {
      core: {
        accounts: {
          async create(
            params: { metadata: Record<string, string> },
            options?: { idempotencyKey?: string },
          ) {
            record("v2.core.accounts.create", options);
            const existing = [...accounts.values()].find(
              (value) => value.idempotencyKey === options?.idempotencyKey,
            );
            if (existing) return v2Account(existing);
            const value: ConnectedAccount = {
              id: next("acct"),
              idempotencyKey: options?.idempotencyKey,
              metadata: params.metadata,
              transfers: "pending",
              payouts: "pending",
              requirements: [
                {
                  awaiting_action_from: "user",
                  description: "Provide your bank account",
                  minimum_deadline: { status: "currently_due" },
                },
              ],
              banks: [],
            };
            accounts.set(value.id, value);
            return v2Account(value);
          },
          async retrieve(id: string) {
            record("v2.core.accounts.retrieve");
            return v2Account(account(id));
          },
        },
      },
    },
    accounts: {
      async listExternalAccounts(id: string) {
        record("accounts.listExternalAccounts");
        return { data: account(id).banks };
      },
    },
    accountSessions: {
      async create(params: { account: string }) {
        record("accountSessions.create");
        account(params.account);
        return { client_secret: next("accs_secret") };
      },
    },
    transfers: {
      async create(
        params: { amount: number; destination: string },
        options?: { idempotencyKey?: string },
      ) {
        record("transfers.create", options);
        const error = failures.transfer.shift();
        if (error) throw error;
        const existing = transfers.find(
          (value) => value.idempotencyKey === options?.idempotencyKey,
        );
        if (existing) return existing;
        const value = {
          id: next("tr"),
          ...params,
          idempotencyKey: options?.idempotencyKey,
        };
        transfers.push(value);
        return value;
      },
    },
    webhooks: new Stripe("sk_test_unused").webhooks,
  };

  function account(id: string) {
    const value = accounts.get(id);
    if (!value)
      throw new FakeError("No such account", "StripeInvalidRequestError", 404);
    return value;
  }

  return {
    client,
    calls,
    failures,
    intents,
    accounts,
    transfers,
    /** What finishing Connect onboarding does to the account. */
    completeOnboarding(id: string) {
      const value = account(id);
      value.transfers = "active";
      value.payouts = "active";
      value.requirements = [
        // Stripe leaves eventually-due items open; they must not block.
        {
          awaiting_action_from: "user",
          description: "Date of birth",
          minimum_deadline: { status: "eventually_due" },
        },
      ];
      value.banks = [
        {
          id: next("ba"),
          object: "bank_account",
          status: "new",
          default_for_currency: true,
          bank_name: "STRIPE TEST BANK",
          last4: "6789",
          currency: "usd",
        },
      ];
    },
    /** What the browser does when the caller confirms the Payment Element. */
    confirm(id: string) {
      intent(id).status = "requires_capture";
    },
    addSavedCard(customer: string) {
      const id = next("pm");
      methods.set(id, { customer });
      return id;
    },
    transient: () => new FakeError("Network down", "StripeConnectionError"),
    declined: () => new FakeError("Card declined", "StripeCardError", 402),
    /** A Stripe-signed webhook request. */
    async signedEvent(type: string, object: Record<string, unknown>) {
      const payload = JSON.stringify({
        id: next("evt"),
        object: "event",
        type,
        data: { object },
      });
      const signature = await client.webhooks.generateTestHeaderStringAsync({
        payload,
        secret: WEBHOOK_SECRET,
      });
      return { payload, signature };
    },
  };
}

type ConnectedAccount = {
  id: string;
  idempotencyKey?: string;
  metadata: Record<string, string>;
  transfers: string;
  payouts: string;
  requirements: {
    awaiting_action_from: string;
    description: string;
    minimum_deadline?: { status: string };
  }[];
  banks: Record<string, unknown>[];
};

function v2Account(value: ConnectedAccount) {
  return {
    id: value.id,
    object: "v2.core.account",
    metadata: value.metadata,
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: value.transfers },
            payouts: { status: value.payouts },
          },
        },
      },
    },
    requirements: { entries: value.requirements },
  } as unknown as Stripe.V2.Core.Account;
}

export type FakeStripe = ReturnType<typeof createFakeStripe>;
