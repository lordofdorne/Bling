# Proposed: platform-held creator balances with monthly payouts

Status: **proposal, not implemented.** Written 2026-09-10 for review. No code or schema in this document exists yet.

## Goal

A creator signs up for Bling, goes live, and earns immediately, with no Stripe step. Earnings accumulate as a balance Bling holds. Identity verification is collected only when they are about to be paid. Bling pays out once a month.

## What is and is not possible

Holding funds and paying monthly is a standard, fully supported pattern. Removing verification entirely is not: anyone who receives money must be identity-verified, which is a regulatory requirement rather than a Stripe limitation. The realistic target is therefore **deferral**, not elimination — nothing at signup, a short identity step before the first payout.

For most US individuals that step is name, date of birth, SSN last 4, and a bank account.

## Why this forces a change to the charge pattern

Today Bling uses **destination charges**: at capture, Stripe moves the creator's share to their connected account and returns a 30% application fee. A destination charge requires a transfer-ready connected account *at the moment of payment*. That requirement is precisely what forces creators to set up Stripe before they can earn.

**Separate charges and transfers** removes it. The payment lands wholly in Bling's balance; transfers are created later, on Bling's schedule. This is what makes deferral possible.

One rule comes with it: with separate charges and transfers, the platform's cut is taken by **transferring less**, never with `application_fee_amount`. Using both together is incorrect.

The Accounts v2 recipient accounts already implemented are the correct account type for this pattern, so that work carries over unchanged.

## Money flow

| Stage | Today | Proposed |
| --- | --- | --- |
| Caller admitted | Card authorized; destination account and fee snapshotted | Unchanged |
| Creator selects caller | Captured; Stripe splits to creator, fee to Bling | Captured wholly into the Bling balance |
| Call ends | — | Ledger credits the creator their 70% once the refund window closes |
| Refund (never reached `LIVE`) | Refund with `reverse_transfer` and `refund_application_fee` | Refund the charge; no transfer to reverse |
| Month end | — | One transfer per creator for their available balance |

Refund handling gets materially simpler and safer: money that was never moved does not have to be clawed back.

Fee arithmetic is unchanged — 30% of the tier price, integer cents, rounding down — but it is applied when the ledger entry is written rather than sent to Stripe at capture.

## Ledger

Balances are derived from an append-only entry table rather than a mutable counter column, so every movement is auditable and no update can silently lose money.

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

Balance is `SUM(amount_cents)` per creator, indexed on `creator_id`. Available balance additionally requires `available_at <= now()`. If summation becomes hot, add a periodic rollup rather than a mutable balance column.

`idempotency_key` is what makes the ledger safe to retry: a redelivered webhook or a re-run payout job cannot double-credit or double-pay.

**`available_at` matters.** A credit becomes available only once the call has ended and its refund window has passed. Paying out money that may still be refunded creates negative balances that are hard to recover.

## Payout run

A monthly job, safe to re-run:

1. Select creators whose available balance meets a configured minimum.
2. Skip any whose transfers capability is not `active`; their balance simply rolls to the next run.
3. Create one Stripe transfer per creator, keyed `bling-payout-<creator_id>-<period>`, so a retry or overlapping replica cannot pay twice.
4. Write a `PAYOUT` debit and a `payout_item` in the same transaction as the transfer record.
5. On failure, mark the item failed and leave the balance intact for the next run.

Concurrency follows the existing worker pattern: PostgreSQL row locks with `SKIP LOCKED`, so multiple API replicas can run it without coordination.

## Changes to existing behavior

- **The readiness gate is removed.** `charges_enabled AND payouts_enabled AND details_submitted` is currently inlined in payment, queue and show SQL to block paid tiers without a ready payout account. Under this model a creator may run paid tiers before onboarding; readiness moves from *earning* to *withdrawing*.
- **Onboarding moves to first withdrawal**, triggered by the creator or by the first payout run that finds them eligible.
- **Disputes** already debit the Bling balance. The dispute must additionally reverse the creator's ledger credit if it has not been paid out, and create a negative balance if it has. That negative balance needs a stated policy.

## Onboarding experience

The current hosted Stripe link is what makes this feel like "setting up Stripe" — it redirects to a Stripe-branded page. Connect **embedded components** keep identity collection inside the creator studio, which reads as setting up a Bling account. This is a frontend addition plus a client-secret endpoint, and is separable from the ledger work: the ledger can ship first with the existing hosted link, deferred.

## Operational surface

New metrics: total held balance, unpaid balance older than one cycle, payout run duration, failed payout items, creators with a balance but no verified account. Alert on failed items and on balances aging past two cycles.

## Open questions for you

1. **Payout schedule and minimum.** Calendar month end, or rolling 30 days? Minimum payout amount?
2. **Refund window.** How long after a call ends before its earnings become available?
3. **Unclaimed balances.** What happens to a creator who earns but never verifies? Reminder cadence, and a cutoff policy.
4. **Negative balances** from disputes on already-paid earnings: absorb, or carry against future earnings?
5. **Compliance.** Holding creator funds for a month is a normal marketplace arrangement, but the holding period and the unclaimed-funds policy are worth confirming with Stripe and your counsel. That confirmation should happen before this ships, not after.

## Non-goals

Instant or daily payouts, creator-initiated withdrawal on demand, multi-currency, and non-US creators. Each is additive later.

## Rollout

The schema is additive and can ship before the charge-flow change. Suggested order: ledger tables and entry writing alongside the existing destination charges (dual-write, no behavior change) → verify ledger totals against Stripe → switch capture to separate charges → remove the readiness gate → enable the payout run → optionally move onboarding to embedded components.

Because `creator_payout_accounts` currently holds a single test row and no real money has moved, this is the cheapest point at which to make the change.
