# Stripe payments

Bling uses Stripe PaymentIntents with manual capture. A paid caller authorizes the tier price before joining the queue; Stripe places a temporary hold, but no money is captured yet. When the host selects that caller, the API first reserves the call in PostgreSQL, captures the exact snapshotted amount with an idempotency key, and only then changes the call to `CREATED`, publishes selection, and permits signaling.

Free tiers never call Stripe. Paid tiers fail closed when Stripe is not configured or the creator has not completed payout onboarding.

## Creator payouts and platform fee

Creators connect a Stripe connected account from the dashboard. Accounts are created through the Accounts v2 API (`POST /v2/core/accounts`) as recipient accounts with an Express dashboard, because Stripe rejects v1 `type=express` creation for new Connect integrations. Bling stays merchant of record and the platform collects both fees and losses, so only the `stripe_balance.stripe_transfers` capability is requested; a merchant configuration is deliberately not requested, as it is unnecessary for this model and lengthens onboarding. Bling creates destination charges: the creator's connected account receives the call proceeds and Stripe returns a fixed 30% application fee to Bling. Stripe processing fees are paid by the Bling platform, so the creator's contractual share is 70% of the call price.

Paid-call readiness follows the v2 capability status, not the deprecated v1 `charges_enabled` and `payouts_enabled` fields. `creator_payout_accounts.transfers_status` records the capability verbatim and only `active` admits paid callers. The three boolean columns remain because the readiness predicate is inlined in payment, queue and show SQL; they are now derived from the transfers capability, and `charges_enabled` mirrors it rather than describing a capability of its own, since a recipient account never accepts charges itself. `account.updated` webhooks supply only an account ID: that event carries the v1 account shape, so the payout service re-reads authoritative state through the v2 API instead of writing the payload's fields. Stripe's v2 capability events (`v2.core.account[configuration.recipient].capability_status_updated`) are delivered as thin events through a separate event-destination mechanism and are not yet wired up; readiness stays correct because the status endpoint refreshes from Stripe on every read.

Every paid authorization snapshots the destination account, the 3,000-basis-point fee policy, the whole-cent application fee, and the creator's tier price. The fee uses integer cents and rounds down when 30% is fractional. These fields are verified against Stripe before queue admission and cannot be changed by later tier edits.

Paid Hotlines cannot start until Stripe reports `details_submitted`, `charges_enabled`, and `payouts_enabled`. The signed `account.updated` webhook keeps those capabilities current. Account Links are generated only for the signed-in creator, use fixed application return URLs, and are treated as single-use redirects.

## Refund and recovery policy

If a paid call is captured but never reaches `LIVE`, ending or failing that call schedules a full refund in the same PostgreSQL transaction. A background worker creates the Stripe refund with `reverse_transfer=true` and `refund_application_fee=true`, so the creator transfer and Bling's fee are both returned as part of the reversal. Calls that reached `LIVE` are never refunded automatically; later customer-support refunds require an explicit policy and endpoint.

Refund requests use a stable Stripe idempotency key, exponential retries, and a ten-attempt ceiling for provider errors. Pending Stripe refunds are polled with the same key and reconciled from `refund.created`, `refund.updated`, and `refund.failed` events.

Every supported Stripe event is claimed in a durable event ledger before processing. Completed event IDs are ignored on redelivery, failed processing can retry, and stale processing claims become reclaimable after five minutes. Dispute and connected-account payout events are retained for creator activity, operational alerts, and support investigation.

## Local test mode

1. Create or open a Stripe sandbox with Connect enabled and copy its test secret and publishable keys into `.env` as `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`. Set `STRIPE_CONNECT_COUNTRY` to the two-letter launch country (the local default is `US`).
2. Install and authenticate the Stripe CLI.
3. In a separate terminal, forward signed events:

   ```sh
   stripe listen \
     --forward-to localhost:8080/api/v1/payments/webhook \
     --forward-connect-to localhost:8080/api/v1/payments/webhook
   ```

4. Copy the printed `whsec_...` value into `.env` as `STRIPE_WEBHOOK_SECRET`, then restart the API.
5. Run PostgreSQL, Redis, migrations, the API, and the web app as usual. On the creator dashboard, choose **Set up payouts** and complete Stripe's test onboarding, including a test payout account.
6. Configure a paid tier on a draft Hotline and start it. In Stripe's payment form use test card `4242 4242 4242 4242`, any future date, and any three-digit CVC. Never use a real card in test mode.

The CLI profile used by `stripe listen --print-secret`, `stripe listen`, and `stripe trigger` must be the same. Bling uses the Dahlia generation of Stripe's Go SDK so it can strictly validate and deserialize events emitted by a Dahlia-versioned Stripe account; keep the SDK and configured webhook endpoint on the same Stripe API release train during future upgrades.

The caller page should say the card is authorized, the Stripe Dashboard should show an uncaptured payment, and selecting the caller should change it to succeeded before the audio call opens. Leaving the queue cancels and releases the authorization. Failing the selected call before it reaches `LIVE` should create a succeeded full refund with a transfer reversal and application-fee refund. Stripe's payment, refund, dispute, account, and connected payout webhooks reconcile interrupted API requests idempotently.

## Operational rules

- Do not log client secrets, card details, Stripe signatures, or API keys.
- Configure the webhook endpoint with the raw signing secret for each environment.
- Configure the Stripe event destination to receive events from both the platform account and connected accounts; `account.updated` is a connected-account event.
- Authorization holds expire on card-network timelines. Canceled or failed intents are removed from the queue by webhook reconciliation.
- The database amount, currency, show, tier, viewer identity, and one-time queue claim are all verified before admission.
- The connected-account destination and 30% application fee are also verified before admission.
- Automatic refunds cover only captured calls that never reached `LIVE`. Manual/partial refund authorization, dispute evidence submission, negative-balance funding, and tax reporting remain separate operational work.
