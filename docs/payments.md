# Stripe payments

Bling uses Stripe PaymentIntents with manual capture. A paid caller authorizes the tier price before joining the queue; Stripe places a temporary hold, but no money is captured yet. When the host selects that caller, the API first reserves the call in PostgreSQL, captures the exact snapshotted amount with an idempotency key, and only then changes the call to `CREATED`, publishes selection, and permits signaling.

Free tiers never call Stripe. Paid tiers fail closed when Stripe is not configured.

## Local test mode

1. Create or open a Stripe sandbox and copy its test secret and publishable keys into `.env` as `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`.
2. Install and authenticate the Stripe CLI.
3. In a separate terminal, forward signed events:

   ```sh
   stripe listen --forward-to localhost:8080/api/v1/payments/webhook
   ```

4. Copy the printed `whsec_...` value into `.env` as `STRIPE_WEBHOOK_SECRET`, then restart the API.
5. Run PostgreSQL, Redis, migrations, the API, and the web app as usual. Configure a paid tier on a draft Hotline and start it.
6. In Stripe's payment form use test card `4242 4242 4242 4242`, any future date, and any three-digit CVC. Never use a real card in test mode.

The caller page should say the card is authorized, the Stripe Dashboard should show an uncaptured payment, and selecting the caller should change it to succeeded before the audio call opens. Leaving the queue cancels and releases the authorization. Stripe's `payment_intent.succeeded`, `payment_intent.canceled`, and `payment_intent.payment_failed` webhooks reconcile interrupted API requests idempotently.

## Operational rules

- Do not log client secrets, card details, Stripe signatures, or API keys.
- Configure the webhook endpoint with the raw signing secret for each environment.
- Authorization holds expire on card-network timelines. Canceled or failed intents are removed from the queue by webhook reconciliation.
- The database amount, currency, show, tier, viewer identity, and one-time queue claim are all verified before admission.
