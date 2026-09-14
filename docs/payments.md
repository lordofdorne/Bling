# Stripe payments and creator payouts

Bling uses Stripe PaymentIntents with manual capture. A paid caller authorizes the tier price before joining the queue. Stripe captures the exact snapshotted amount only after the creator selects that caller; free tiers never call Stripe.

## Platform charges and earnings

New payment attempts use the `PLATFORM` flow. Their PaymentIntents contain neither `transfer_data.destination` nor `application_fee_amount`, so the captured payment remains in Bling's platform balance. The attempt snapshots the 3,000-basis-point fee and whole-cent fee amount. When the call first reaches `LIVE`, one immutable ledger entry credits the creator with gross less that fee. The credit becomes available after `CREATOR_EARNINGS_HOLD`.

Creators may create paid tiers, go live, and earn without payout setup. Readiness only controls monthly transfers. Historical `DESTINATION` attempts remain supported: their original connected-account destination and application fee are still verified, reconciled, and refunded correctly.

The complete data model, state machines, rollout, and operating contract are in [creator-payout-implementation-runbook.md](creator-payout-implementation-runbook.md).

The implementation plan for caller-saved payment methods, Link, and explicit creator bank-account readiness is in [saved-payments-and-bank-payouts-plan.md](saved-payments-and-bank-payouts-plan.md).

## Payout setup

The dashboard creates a short-lived Stripe Account Session for the signed-in creator and renders Connect embedded onboarding inside Bling. Newly created Accounts v2 recipients request only the `stripe_balance.stripe_transfers` capability and use no Stripe dashboard. Stripe collects identity, bank, document, validation, and service-agreement information directly; Bling does not receive or log it.

An onboarding exit or return is never treated as completion. Bling retrieves the account and requires an active transfers capability. Currently-due and past-due user requirements block transfer readiness; eventually-due requirements do not create a setup loop.

## Monthly transfer worker

The worker is off unless `CREATOR_PAYOUTS_ENABLED=true`. On `CREATOR_PAYOUT_DAY`, it creates one run for the previous calendar month, reserves each verified creator's available balance above `CREATOR_PAYOUT_MINIMUM_CENTS`, and sends one idempotent Stripe transfer per payout item. `SKIP LOCKED`, unique run/item constraints, stable Stripe idempotency keys, and immutable payout-reservation ledger entries make concurrent and repeated execution safe.

The transfer moves money from Bling to the connected Stripe balance. A later connected-account payout moves that balance to the creator's bank and is tracked separately through payout webhooks.

Defaults:

```text
CREATOR_EARNINGS_HOLD=168h
CREATOR_PAYOUT_MINIMUM_CENTS=2500
CREATOR_PAYOUT_DAY=1
CREATOR_PAYOUT_CURRENCY=usd
CREATOR_PAYOUTS_ENABLED=false
```

## Refund and dispute policy

If a captured call never reaches `LIVE`, Bling schedules a full refund and creates no earning. A `PLATFORM` refund does not request a transfer or application-fee reversal because neither exists. Historical `DESTINATION` refunds retain both reversal flags.

If a refund succeeds after an earning exists, a database trigger adds one creator-share reversal. Open disputes add one dispute debit; a won or prevented dispute adds one release. Unique business-event keys make webhook redelivery safe. Negative balances carry against future earnings.

For new paid calls, the creator receives 80% of the listed call price less half of the published basic domestic-card fee (2.9% + $0.30). Bling retains 20% and absorbs the other half, including the extra cent when the fee is odd. The published basic fee and both creator deductions are snapshotted on the payment attempt so later pricing changes cannot alter an existing call. Bling absorbs any difference between that published basic fee and Stripe's actual fee for international cards, currency conversion, or other payment methods.

## Local sandbox flow

1. Configure Stripe test secret, publishable, and webhook keys in `.env` and keep `CREATOR_PAYOUTS_ENABLED=false`.
2. Run `make db-up`, `make migrate`, the API, and the frontend.
3. Forward platform and connected events to `/api/v1/payments/webhook` with the Stripe CLI.
4. Create a paid tier without payout setup, authorize test card `4242 4242 4242 4242`, select the caller, and transition the call to `LIVE`.
5. Confirm the charge has no destination and `/api/v1/payouts/balance` reports the pending creator share.
6. Open **Set up payouts** and finish the embedded test onboarding. Confirm a page refresh still reports the account ready.
7. Test a payout run with a controlled clock or manual worker invocation before enabling the production scheduler.

## Operational rules

- Never log Account Session secrets, PaymentIntent client secrets, card or bank data, identity data, Stripe signatures, or API keys.
- Reconcile platform charges, refunds, disputes, transfers, connected payouts, and ledger liability every payout cycle.
- Maintain enough available platform balance and a loss reserve for refunds and disputes. Aggregate monthly transfers can temporarily fail when the Stripe platform balance is unavailable.
- Configure tax reporting, unclaimed balances, creator terms, and support procedures before production payouts.
- Ask Stripe about funds segregation availability; the system does not assume that private-preview feature exists.
