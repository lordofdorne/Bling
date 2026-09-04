# Stripe payments

Bling uses Stripe PaymentIntents with manual capture. A paid caller authorizes the tier price before joining the queue; Stripe places a temporary hold, but no money is captured yet. When the host selects that caller, the API first reserves the call in PostgreSQL, captures the exact snapshotted amount with an idempotency key, and only then changes the call to `CREATED`, publishes selection, and permits signaling.

Free tiers never call Stripe. Paid tiers fail closed when Stripe is not configured or the creator has not completed payout onboarding.

## Creator payouts and platform fee

Creators connect a Stripe Express account from the dashboard. Bling creates destination charges: the creator's connected account receives the call proceeds and Stripe returns a fixed 30% application fee to Bling. Stripe processing fees are paid by the Bling platform, so the creator's contractual share is 70% of the call price.

Every paid authorization snapshots the destination account, the 3,000-basis-point fee policy, the whole-cent application fee, and the creator's tier price. The fee uses integer cents and rounds down when 30% is fractional. These fields are verified against Stripe before queue admission and cannot be changed by later tier edits.

Paid Hotlines cannot start until Stripe reports `details_submitted`, `charges_enabled`, and `payouts_enabled`. The signed `account.updated` webhook keeps those capabilities current. Account Links are generated only for the signed-in creator, use fixed application return URLs, and are treated as single-use redirects.

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

The caller page should say the card is authorized, the Stripe Dashboard should show an uncaptured payment, and selecting the caller should change it to succeeded before the audio call opens. Leaving the queue cancels and releases the authorization. Stripe's `payment_intent.succeeded`, `payment_intent.canceled`, and `payment_intent.payment_failed` webhooks reconcile interrupted API requests idempotently.

## Operational rules

- Do not log client secrets, card details, Stripe signatures, or API keys.
- Configure the webhook endpoint with the raw signing secret for each environment.
- Configure the Stripe event destination to receive events from both the platform account and connected accounts; `account.updated` is a connected-account event.
- Authorization holds expire on card-network timelines. Canceled or failed intents are removed from the queue by webhook reconciliation.
- The database amount, currency, show, tier, viewer identity, and one-time queue claim are all verified before admission.
- The connected-account destination and 30% application fee are also verified before admission.
- Refunds, transfer reversals, disputes, negative balances, tax reporting, and payout operations require a dedicated follow-up before production launch.
