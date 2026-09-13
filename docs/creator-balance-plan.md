# Proposed: platform-held creator balances, Bling-run payout setup, monthly payouts

Status: **superseded.** This original proposal is retained for decision history. The approved, implementation-grade source of truth is [creator-payout-implementation-runbook.md](creator-payout-implementation-runbook.md); its embedded-onboarding and payout-saga decisions replace conflicting details below.

## What a creator experiences

1. Signs up for Bling. No payment setup of any kind.
2. Goes live and takes paid calls immediately. Earnings appear as a balance in the creator studio.
3. Before their first payout, fills in a **Bling** form: name, address, date of birth, SSN last 4, and bank account.
4. Gets paid at the end of the month.

The creator never sees a Stripe page, never creates a Stripe account, and never leaves Bling. Stripe is infrastructure Bling uses, not a product the creator signs up for.

## The one thing that cannot be removed

Whoever receives money has to be identity-verified. That is a legal requirement and no processor can waive it. What *is* removable — and what this plan removes — is the creator ever dealing with Stripe: the redirect, the Stripe-branded onboarding, the Stripe dashboard, the Stripe account.

So the data still gets collected. It is collected by Bling, in Bling's own interface, as part of "set up your payout details."

## How it works

### Account configuration

Connected accounts are created as they are today, with two changes:

| Setting | Now | Proposed |
| --- | --- | --- |
| `dashboard` | `express` | `none` |
| Requirement collection | Stripe (hosted onboarding) | `application` (Bling collects) |
| Fees / losses collector | `application` | unchanged |
| Capability | `stripe_balance.stripe_transfers` | unchanged |

This is Stripe's white-label configuration. The three accounts already sitting in the sandbox use exactly this shape, so it is known to work on this platform.

Accounts are created silently when a creator first earns — not when they sign up, and not by any action they take.

### Collecting payout details without holding the sensitive data

The identity fields go straight from the creator's browser to Stripe using **account tokens**: Stripe.js tokenizes the form client-side and Bling's servers receive only a token, which is attached to the connected account.

This matters. Date of birth, SSN, and bank numbers never reach Bling's servers, logs, or database, which keeps the sensitive-data burden roughly where it is today. Building the form the naive way — posting an SSN to Bling's API — would be a materially different security and compliance posture. The plan is the tokenized version.

Bling stores only what it needs to show status: which fields are outstanding, and whether the account can receive transfers.

### Holding funds and paying monthly

Today Bling uses **destination charges**: at capture, Stripe immediately splits the payment to the creator's account. A destination charge requires a transfer-ready account *at the moment of payment*, which is exactly what forces payout setup to happen before a creator can earn.

**Separate charges and transfers** removes that. The payment lands wholly in Bling's balance and stays there. Transfers are created later, on Bling's schedule.

One rule comes with it: the platform's cut is taken by **transferring less**, never with `application_fee_amount`. Using both together is incorrect.

| Stage | Today | Proposed |
| --- | --- | --- |
| Caller admitted | Card authorized, fee snapshotted | Unchanged |
| Creator selects caller | Captured, split to creator immediately | Captured wholly into Bling's balance |
| Call ends | — | Ledger credits the creator 70% once the refund window closes |
| Refund before `LIVE` | Refund with `reverse_transfer` and `refund_application_fee` | Refund the charge; no transfer to reverse |
| Month end | — | One transfer per creator for their available balance |

Refunds get simpler and safer: money that never moved does not have to be clawed back. Fee arithmetic is unchanged — 30%, integer cents, rounding down — just applied when the ledger entry is written instead of at capture.

## Ledger

Balances derive from append-only entries rather than a mutable counter, so every movement is auditable and no update can silently lose money.

```
creator_ledger_entries
  id              BIGSERIAL PRIMARY KEY
  creator_id      UUID NOT NULL REFERENCES users(id)
  kind            TEXT NOT NULL   -- EARNING | REFUND_REVERSAL | DISPUTE_REVERSAL
                                  -- | PAYOUT | PAYOUT_REVERSAL | ADJUSTMENT
  amount_cents    BIGINT NOT NULL -- signed: credits positive, debits negative
  currency        TEXT NOT NULL DEFAULT 'usd'
  available_at    TIMESTAMPTZ     -- when this credit may be paid out
  payment_attempt_id UUID REFERENCES payment_attempts(id)
  call_id         UUID
  payout_item_id  BIGINT
  idempotency_key TEXT NOT NULL UNIQUE
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()

payout_runs    (id, period, status, started_at, completed_at)
payout_items   (id, run_id, creator_id, amount_cents, stripe_transfer_id,
                status, failure_code, idempotency_key UNIQUE)
```

Balance is `SUM(amount_cents)` per creator, indexed on `creator_id`; available balance additionally requires `available_at <= now()`. If summation becomes hot, add a periodic rollup rather than a mutable column.

`idempotency_key` is what makes this safe to retry: a redelivered webhook or a re-run payout job cannot double-credit or double-pay.

**`available_at` is load-bearing.** A credit becomes available only after the call ends and its refund window passes. Paying out money that might still be refunded creates negative balances that are painful to recover.

## Monthly payout run

A job that is safe to re-run and safe to run concurrently:

1. Select creators whose available balance meets the configured minimum.
2. Skip any whose transfers capability is not `active` — their balance rolls to the next run untouched.
3. Create one transfer per creator, keyed `bling-payout-<creator_id>-<period>`, so a retry or a second replica cannot pay twice.
4. Write the `PAYOUT` debit and the `payout_item` in the same transaction as the transfer record.
5. On failure, mark the item failed and leave the balance intact for next time.

Concurrency follows the existing worker pattern — row locks with `SKIP LOCKED` — so replicas need no coordination.

## What Bling takes on

Worth stating plainly, because this is the real cost of the white-label model:

- **Requirement remediation.** When Stripe later asks for more information, there is no Stripe UI to send the creator to. Bling must surface the outstanding fields and collect them. This is the main reason Stripe's default guidance steers platforms toward hosted onboarding, and it is an ongoing obligation, not a one-time build.
- **Support and disputes.** No Stripe dashboard for creators means every "where is my money" question arrives at Bling.
- **Losses.** Already the case — the platform is the losses collector.

## Changes to what already exists

- The readiness gate `charges_enabled AND payouts_enabled AND details_submitted`, currently inlined in payment, queue and show SQL, no longer blocks paid tiers. Readiness moves from *earning* to *withdrawing*.
- Account creation switches from `dashboard: express` to the white-label configuration above. The single sandbox account created under the current code would be recreated; no real money has moved.
- Disputes must reverse the creator's ledger credit if it has not been paid out, and create a negative balance if it has.

## Operational surface

New metrics: total held balance, balance unpaid beyond one cycle, payout run duration, failed payout items, and creators carrying a balance with no verified account. Alert on failed items and on balances aging past two cycles.

## Open questions

1. **Schedule and minimum.** Calendar month end or rolling 30 days? Minimum payout amount?
2. **Refund window.** How long after a call ends before earnings become available?
3. **Unclaimed balances.** A creator earns but never completes payout details: reminder cadence, and a cutoff policy.
4. **Negative balances** from disputes on already-paid earnings: absorb, or carry against future earnings?
5. **Compliance.** Holding creator funds for a month and collecting KYC data as the platform are both standard marketplace arrangements, but the holding period, the unclaimed-funds policy, and the white-label responsibilities are worth confirming with Stripe and your counsel before this ships.

## Non-goals

Instant or on-demand withdrawal, multi-currency, non-US creators, and business (non-individual) accounts. Each is additive later.

## Rollout

The schema is additive and can land before any behavior changes. Suggested order:

1. Ledger tables, written alongside the existing destination charges — dual-write, no behavior change.
2. Verify ledger totals reconcile against Stripe.
3. Switch capture to separate charges and transfers.
4. Switch account creation to the white-label configuration and build the tokenized payout-details form.
5. Remove the readiness gate so creators earn before setup.
6. Enable the monthly payout run.

Steps 1 and 2 are reversible and prove the accounting before any money moves differently. Because `creator_payout_accounts` holds one test row and no real money has moved, this is the cheapest moment to make the change.
