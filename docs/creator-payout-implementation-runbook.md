# Creator balances and monthly payouts: implementation runbook

Status: **approved for implementation**. Updated 2026-09-10. This document is the handoff source of truth for any engineer or agent continuing the work.

## Product contract

A creator can sign up, create paid tiers, go live, and earn without completing payout setup. Bling collects the caller's payment into the platform Stripe balance and records the creator's share in an internal append-only ledger. Before a creator can receive their first payout, they complete an embedded “Set up payouts” flow inside Bling. Bling pays eligible balances monthly.

The creator should experience this as a Bling flow. Stripe still creates the regulated connected account, collects the required identity and bank information, presents its service agreement, and may request updated information later. The UI must say “payout setup,” not “create a Stripe account.”

Initial scope:

- United States, USD, individual creators.
- Monthly run for the previous calendar month, started on the first day of the next month in UTC.
- $25 minimum payout; smaller balances carry forward.
- Earnings become available seven days after the paid call reaches `LIVE`. This delay is configurable and is not a substitute for a platform loss reserve.
- A creator with incomplete verification keeps earning. Their balance carries forward until Stripe says transfers are active.
- Negative balances from disputes carry against future earnings. Bling remains responsible if the creator never earns enough to offset them.

## Architecture decisions

1. **Use separate charges and transfers.** New PaymentIntents have no `transfer_data.destination` and no `application_fee_amount`. The full charge lands in the platform balance. The creator share remains the existing fee calculation: gross minus the snapshotted platform fee.
2. **Keep historical destination charges intact.** Add a `payment_flow` discriminator. Existing attempts with a destination are `DESTINATION`; new attempts are explicitly `PLATFORM`. Refund logic reads this value so historical charges still reverse transfers and fees correctly.
3. **Credit earnings when a call first reaches `LIVE`.** Calls refunded before `LIVE` never become creator earnings. A unique ledger key makes replay safe.
4. **Use an immutable signed ledger.** Credits are positive and debits are negative. Never edit or delete an entry. Correct mistakes with a compensating entry.
5. **Use Stripe embedded onboarding.** Create the connected account when the creator starts payout setup, then return an Account Session client secret to Stripe's embedded onboarding component. This keeps the creator in Bling and lets Stripe own changing KYC, document, bank, validation, and agreement requirements. A fully custom account-token form is deferred because it requires Bling to maintain every country and requirement change and cannot configure every account setting by token alone.
6. **Treat transfer and bank payout as different events.** The monthly job transfers the creator's payable amount from Bling to the connected Stripe balance. Stripe then pays their bank according to the connected account balance settings. The UI displays the transfer state accurately and does not claim a bank deposit has settled until a payout webhook confirms it.
7. **Use a database-to-Stripe saga.** PostgreSQL and Stripe cannot share a transaction. Reserve the balance and commit a payout item first, call Stripe with a stable idempotency key, then finalize the item. An ambiguous network result is reconciled with Stripe before retrying.

Relevant Stripe references:

- https://docs.stripe.com/connect/separate-charges-and-transfers
- https://docs.stripe.com/connect/onboarding
- https://docs.stripe.com/connect/embedded-onboarding
- https://docs.stripe.com/connect/manage-payout-schedule
- https://docs.stripe.com/connect/payouts-connected-accounts
- https://docs.stripe.com/connect/tax-reporting

Ask Stripe about access to funds segregation before production launch. It is a private-preview feature and this implementation must work correctly without assuming it is enabled.

## Data model

Migration `000012_creator_balances` is additive.

### Payment flow

Add `payment_attempts.payment_flow` with values `DESTINATION` and `PLATFORM`. Use a rollout-safe default of `DESTINATION`, backfill rows with a destination as `DESTINATION`, and have the new application explicitly insert `PLATFORM`. Relax the old Connect snapshot constraint so platform attempts retain the fee snapshot while having no destination account.

### Ledger

`creator_ledger_entries`:

| Column | Contract |
| --- | --- |
| `id` | `BIGSERIAL` primary key |
| `creator_id` | owner of the balance |
| `kind` | `EARNING`, `REFUND_REVERSAL`, `DISPUTE_DEBIT`, `DISPUTE_RELEASE`, `PAYOUT_RESERVATION`, `PAYOUT_RELEASE`, or `ADJUSTMENT` |
| `amount_cents` | signed, non-zero bigint |
| `currency` | lowercase ISO currency; USD initially |
| `effective_at` | entry contributes to available balance at this time |
| `payment_attempt_id` / `call_id` / `payout_item_id` | nullable audit links |
| `idempotency_key` | globally unique business-event key |
| `metadata` | non-sensitive JSON context |
| `created_at` | immutable creation time |

Balance definitions:

- **total owed**: sum of all ledger entries through now, including earnings that are still pending.
- **available**: sum of entries whose `effective_at <= now()`.
- **pending**: `total owed - available`.
- **payable**: available balance clamped at zero, after all payout reservations.

All debits are effective immediately. An earning's `effective_at` is the first `LIVE` timestamp plus the configured hold. Index `(creator_id, currency, effective_at, id)` and the referenced event IDs. Enforce one `EARNING` per payment attempt and one active dispute debit per Stripe dispute through idempotency keys.

### Payout saga

`creator_payout_runs` has one row per currency and calendar period with state `CREATED`, `PROCESSING`, `COMPLETED`, or `PARTIAL_FAILED`.

`creator_payout_items` has one row per creator/run/currency with state:

```text
RESERVED -> SENDING -> PAID
                  \-> RETRY
                  \-> FAILED -> CANCELED
RETRY -> SENDING
CANCELED creates one PAYOUT_RELEASE credit
```

Each item stores the amount, connected account snapshot, Stripe transfer ID, stable idempotency key, attempt count, next attempt time, last error, and timestamps. Creating the item and its negative `PAYOUT_RESERVATION` entry happens in one database transaction. A successful transfer keeps the reservation as the permanent payout debit. Canceling an item writes one positive `PAYOUT_RELEASE` entry; it never mutates the reservation.

## Application work, in order

### 1. Add schema and accounting repository

- Add migration 12 and its down migration.
- Add a balance package with balance summary, recent entries, earning credit, dispute debit/release, run creation, item claiming, Stripe result finalization, retry, cancellation, and reconciliation operations.
- Use `FOR UPDATE` and `SKIP LOCKED` when claiming payout work.
- Keep every operation idempotent with database unique constraints in addition to Stripe idempotency keys.

Acceptance checks:

- Replaying a call transition does not double-credit.
- Two workers cannot reserve the same creator balance for the same run.
- Canceling a failed item restores exactly the reserved amount once.
- Available, pending, total, and negative balances are correct from ledger entries alone.

### 2. Switch new payments to the platform flow

- Remove the payout-account join and readiness rejection from payment preparation.
- Continue snapshotting the platform fee basis points and cents.
- Create PaymentIntents without destination or application fee fields.
- Persist new attempts as `PLATFORM`.
- Verify Stripe responses according to the persisted flow. Historical `DESTINATION` attempts retain the existing verification and refund behavior.
- For platform-flow refunds, do not set `reverse_transfer` or `refund_application_fee`.

Acceptance checks:

- A paid tier can authorize and capture when the creator has no payout account.
- Captured funds remain in the platform Stripe balance.
- Existing destination attempts still reconcile and refund with their original fields.

### 3. Remove earning-time payout gates

- Remove connected-account readiness predicates from show start and queue/tier selection.
- Preserve authentication, creator ownership, show status, tier activity, capacity, and price checks.
- Credit one `EARNING` ledger entry when a paid call first transitions to `LIVE`, using the payment attempt's gross amount and snapshotted platform fee.

Acceptance checks:

- A creator without payout setup can publish a paid tier, start a show, and accept a paid caller.
- A captured call that never reaches `LIVE` is refunded and creates no earning.

### 4. Add embedded payout setup

- Configure newly created Accounts v2 recipients for transfers, platform-collected fees/losses, and no creator Stripe dashboard where supported.
- Add an authenticated endpoint that ensures the creator account exists and returns a short-lived Account Session client secret.
- Enable only the embedded onboarding component and the minimum required features.
- Continue processing account update events and derive readiness from the transfers capability. The return from onboarding is never itself proof of completion.
- Replace redirect-based setup UI with embedded onboarding, a clear requirements state, and a retry/resume action.
- Never log the Account Session secret or identity/bank fields.

Acceptance checks:

- Refreshing or returning from setup does not incorrectly reset a ready creator.
- Eventually-due requirements do not block transfers; currently-due or past-due requirements do.
- A creator can resume an incomplete setup inside Bling.

### 5. Expose creator balances

- Add authenticated creator endpoints for the balance summary and paginated ledger activity.
- Show `Pending`, `Available`, `Next payout`, verification status, and recent activity in the creator dashboard.
- Use honest copy: “Scheduled for transfer,” “Sent to payout account,” and webhook-derived bank payout states.
- Do not expose Stripe IDs, raw requirement payloads, or internal failure traces.

### 6. Run monthly payouts

- Add a worker that creates the previous month's run once, selects verified creators above the configured minimum, reserves each payable balance, and processes items with bounded retries.
- Create one Stripe transfer per item with its stored idempotency key. Aggregate monthly transfers do not use `source_transaction`, so the worker must handle temporary insufficient platform balance with retry/backoff.
- On an ambiguous response, retrieve/reconcile by the recorded Stripe result or idempotency outcome before issuing another logical transfer.
- Leave incomplete creators and sub-minimum balances untouched for the next cycle.
- Set connected-account monthly bank payout settings where supported; keep the UI clear that bank timing follows Stripe/bank processing after Bling's transfer.

### 7. Integrate reversals and operations

- On a post-earning refund, write `REFUND_REVERSAL` for the creator share.
- On an open/lost dispute, write one `DISPUTE_DEBIT`; on a won/closed reversal, write one `DISPUTE_RELEASE` only if a debit exists.
- Add metrics for total held liability, pending, available, negative balances, unverified balances, failed/retrying payout items, and oldest unpaid balance.
- Add structured logs with run/item/payment identifiers and no personal data.
- Document monthly reconciliation: platform balance, charges, refunds, disputes, transfers, bank payouts, and ledger liability.

## Configuration

Add and validate:

```text
CREATOR_EARNINGS_HOLD=168i j
CREATOR_PAYOUT_MINIMUM_CENTS=2500
CREATOR_PAYOUT_DAY=1
CREATOR_PAYOUT_CURRENCY=usd
CREATOR_PAYOUTS_ENABLED=false
```

Production also needs a platform reserve policy, unclaimed-property policy, creator terms, support process, and tax-reporting configuration. These are launch requirements, not code constants.

## Rollout and recovery

1. Deploy migration and ledger reads first.
2. Backfill historical completed paid calls into ledger with deterministic keys; run reconciliation in report-only mode.
3. Deploy code that explicitly marks new attempts `PLATFORM`, removes earning gates, and writes live-call earnings.
4. Confirm new Stripe charges have no destination and reconcile captured totals against ledger credits.
5. Enable embedded payout setup and balance UI.
6. Run a sandbox payout period with the scheduler disabled; verify retry, duplicate invocation, insufficient balance, and cancellation recovery.
7. Enable the monthly scheduler behind `CREATOR_PAYOUTS_ENABLED` after finance and compliance sign-off.

Rollback switches new payments back to `DESTINATION` only if creators are transfer-ready. Never delete ledger or payout records. In-flight platform charges remain governed by the ledger and payout worker until settled.

## Definition of done

- Unit and integration tests cover accounting idempotency, concurrency, payment-flow compatibility, refunds, disputes, and payout retry/recovery.
- Backend and frontend builds pass.
- A sandbox end-to-end run proves: unverified creator earns; balance moves pending to available; embedded setup becomes active; one monthly transfer occurs; duplicate jobs do not duplicate it; dashboard reports the correct state.
- README and environment examples explain configuration, local test steps, operational reconciliation, and the platform's Stripe/compliance responsibilities.
