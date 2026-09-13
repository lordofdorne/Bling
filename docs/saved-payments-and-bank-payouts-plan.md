# Saved caller payments and creator bank payouts

Status: **implementation plan**. Written 2026-09-13. This document is the handoff source of truth for adding reusable caller payment methods and creator bank-account setup without changing Bling's existing call, authorization, capture, balance-ledger, or monthly-transfer rules.

## Product contract

### Callers

- A guest can pay with a new card or Link without creating a Bling account.
- A signed-in Bling user can pay with a new card, use Link, or select a payment method previously saved specifically to their Bling account.
- Saving a method is optional and requires explicit consent in Stripe's Payment Element.
- A user can add and remove saved methods from **Settings → Payments**.
- Bling displays only safe summaries such as brand, last four digits, and expiration date. Bling never receives or stores card numbers, CVCs, or Link credentials.
- Selecting a saved method still creates a fresh PaymentIntent for each call. The existing rule remains: authorize at queue entry, capture only when the creator selects the caller, and cancel or refund through the current lifecycle.

### Creators

- A creator can continue earning before payout setup is complete.
- Under **Settings → Payouts**, a creator can add or update the bank account used for payouts inside Bling's embedded Stripe Connect flow.
- Stripe collects identity, tax, document, service-agreement, and bank details. Bling stores only Stripe resource IDs, capability/readiness state, safe bank summaries when available, and timestamps.
- “Payouts ready” means Stripe confirms that the account can receive a platform transfer and can pay its connected balance to an external bank account. Returning from or exiting onboarding is never treated as completion.
- Bling's monthly balance transfer and Stripe's later bank payout remain separate states in the UI and accounting.

## Architecture decisions

1. **Keep PaymentIntents and manual capture.** Add `card` and `link` as supported payment method types. Do not replace the current queue authorization and later capture flow.
2. **Give each signed-in payer one platform Customer.** The Stripe Customer belongs to the Bling platform account, not a creator's connected account. A deterministic Stripe idempotency key and a unique database constraint make customer creation safe under concurrent requests.
3. **Use Customer Sessions with the Payment Element.** For authenticated callers, return a short-lived Customer Session client secret alongside the PaymentIntent client secret. Enable Stripe's built-in saved-method display, save-consent checkbox, and removal control. Guests receive no Customer Session and no Bling-specific saved methods.
4. **Keep Link optional and distinct from Bling-saved methods.** Link is Stripe's cross-business wallet. A Bling-saved method is attached to the authenticated user's platform Customer. Both can appear in the same Payment Element.
5. **Use a SetupIntent for Settings → Payments.** This lets a signed-in user add a method without buying a call. Use `usage=on_session` because Bling's intended first release reuses the method only while the user is present to request a call. Revisit `off_session` only if Bling later introduces subscriptions, automatic charges, or other merchant-initiated payments.
6. **Keep creator bank collection in Connect embedded onboarding.** The existing Account Session and `ConnectAccountOnboarding` integration remain the source of sensitive collection. Enable external-account collection and use the same component for initial setup and remediation or bank updates.
7. **Model transfer readiness and bank-payout readiness separately.** Accounts v2 recipient configuration requests `stripe_balance.stripe_transfers`, which also requests the payouts capability. Persist and expose both raw Stripe statuses instead of mirroring one status into several legacy booleans.
8. **Treat webhooks and Stripe reads as authoritative.** Browser completion callbacks trigger a refresh only. Persisted state changes after a signed webhook or an authenticated server-side retrieval from Stripe.

## Data model

Add migration `000013_saved_payment_methods_and_payout_readiness`.

### Platform customers

Create `user_payment_profiles`:

| Column | Contract |
| --- | --- |
| `user_id` | UUID primary key and foreign key to `users(id)` |
| `stripe_customer_id` | unique, non-null platform Customer ID |
| `default_payment_method_id` | nullable Stripe PaymentMethod ID; never sufficient by itself to authorize use |
| `created_at` / `updated_at` | audit timestamps |

Do not copy card or Link details into this table. Create the Stripe Customer with metadata containing only the stable Bling user ID. Use `bling-customer-<user_id>` as the Stripe idempotency key. If Stripe succeeds and the database write is ambiguous, retrieve by the recorded result or idempotency outcome before creating another logical customer.

Extend `payment_attempts`:

| Column | Contract |
| --- | --- |
| `payer_user_id` | nullable FK to `users(id)`; null for guests |
| `stripe_customer_id` | nullable snapshot of the platform Customer used for this attempt |
| `save_consent_observed_at` | nullable; set only after Stripe reports a reusable method with redisplay consent |
| `saved_payment_method_id` | nullable audit link to the Stripe PaymentMethod used; never return it in creator-facing APIs |

The viewer cookie remains the authority for queue and call ownership. `payer_user_id` adds payment ownership and must not replace the existing viewer-token checks.

### Creator payout projection

Extend `creator_payout_accounts`:

| Column | Contract |
| --- | --- |
| `transfers_status` | raw Accounts v2 `stripe_balance.stripe_transfers` capability status |
| `bank_payouts_status` | raw Accounts v2 `stripe_balance.payouts` capability status |
| `external_account_present` | safe projection used for UX; true only after Stripe confirms an eligible external account |
| `external_account_bank_name` | nullable safe display value |
| `external_account_last4` | nullable safe display value |
| `external_account_currency` | nullable lowercase ISO currency |
| `requirements_due` | existing actionable user requirements only |
| `updated_at` | last authoritative Stripe refresh |

Keep the old boolean columns during rollout for API compatibility, but derive them from the explicit statuses. Do not store routing numbers, account numbers, identity fields, document data, or full Stripe requirement payloads.

## Backend work, in order

### 1. Add an optional authenticated-user resolver

The public payment authorization route must keep working for guests. Add middleware or a small service that resolves the existing session cookie when valid and otherwise returns no user. Invalid or expired sessions behave as guest checkout; database or provider failures still return an error.

Pass the optional payer ID and email into payment preparation. Never accept a payer user ID from the browser.

Acceptance checks:

- A guest can authorize and join exactly as today.
- A valid signed-in session is attached to the payment attempt.
- A forged request body cannot select another user's Stripe Customer.

### 2. Add the platform-customer service

Create a focused package or subservice with:

- `EnsureCustomer(userID, email)`
- `CreateCustomerSession(userID)`
- `CreateSetupIntent(userID)`
- `ListPaymentMethods(userID)`
- `DetachPaymentMethod(userID, paymentMethodID)`
- `SetDefaultPaymentMethod(userID, paymentMethodID)` if the product keeps an explicit default control

Every mutation must first prove the PaymentMethod belongs to the authenticated user's Stripe Customer. Add bounded timeouts, stable idempotency keys, structured error codes, and logs containing internal user/request IDs but no client secrets or payment details.

Acceptance checks:

- Concurrent first checkouts produce one Customer.
- Retrying after an ambiguous Stripe result does not create a second logical Customer or SetupIntent.
- One user cannot list, detach, or select another user's method.

### 3. Upgrade call authorization

For a signed-in caller:

1. Ensure the platform Customer exists.
2. Create the manual-capture PaymentIntent with that Customer and `payment_method_types=["card", "link"]`.
3. Create a Customer Session for the same Customer with Payment Element features enabled:
   - `payment_method_save`
   - saved payment-method redisplay
   - `payment_method_remove`
   - a small redisplay limit such as 5
4. Return both client secrets.

For a guest, create the same manual-capture PaymentIntent without a Customer Session. Link remains available when enabled for the platform, but the guest receives no Bling-specific saved-method list.

Extend the authorization response:

```json
{
  "attemptId": "uuid",
  "clientSecret": "pi_..._secret_...",
  "customerSessionClientSecret": "cuss_..._secret_... or omitted",
  "publishableKey": "pk_...",
  "amountCents": 2500,
  "currency": "usd"
}
```

Never cache or log either client secret. Preserve the current idempotency key, amount, tier snapshot, viewer-token binding, capture, cancellation, refund, dispute, and creator-ledger behavior.

Acceptance checks:

- Link and card both reach `requires_capture` before queue admission.
- A saved method can authorize a later call without re-entering card details.
- Declines and required authentication stay inside the current error/retry flow.
- Selecting a caller captures exactly once; leaving the queue cancels exactly once.

### 4. Add payment-method settings APIs

Add authenticated routes for every signed-in user:

```text
POST   /api/v1/me/payment-methods/setup-session
GET    /api/v1/me/payment-methods
DELETE /api/v1/me/payment-methods/{paymentMethodID}
PUT    /api/v1/me/payment-methods/{paymentMethodID}/default   (optional for v1)
```

`setup-session` returns a SetupIntent client secret, Customer Session client secret, and publishable key. The list response returns only:

```text
id, type, brand, last4, expiration month/year, default flag
```

Use pagination even if the UI initially displays only a few methods. Reject removal while a method is attached to an active authorization if Stripe or Bling cannot safely detach it; otherwise detaching must not alter historical payment attempts.

### 5. Reconcile saved-method state

Extend webhook handling for the events required by the chosen Stripe API version, including successful SetupIntents and PaymentIntents plus payment-method attachment or detachment events where available.

On reconciliation:

- verify the Stripe Customer matches the attempt's authenticated payer;
- update the attempt's safe audit fields;
- record observed save consent only when Stripe reports the method as reusable and redisplayable;
- never make queue admission depend only on a webhook arriving quickly—the existing synchronous `requires_capture` verification remains.

Webhook claims stay idempotent through the existing `stripe_webhook_events` table.

### 6. Make creator bank readiness explicit

Extend the payout Stripe gateway to retrieve both Accounts v2 recipient capabilities and a safe external-account summary. Update `Account.Ready()` so it requires:

```text
transfers_status == active
bank_payouts_status == active
external_account_present == true
no currently_due or past_due requirement awaiting user action
```

Keep external-account collection enabled in the Account Session. Add separate service intents for:

- initial payout setup;
- resuming incomplete verification;
- updating a bank account after setup;
- remediating a failed or disabled bank account.

Use narrowly scoped Account Sessions and embedded onboarding collection options where the Stripe API supports them. A payout failure that disables an external account must mark the account as needing attention and offer **Update bank account**.

Acceptance checks:

- Exiting onboarding halfway leaves the creator incomplete.
- Completing identity fields without a usable bank account does not show “ready.”
- Completing all requirements survives refresh and a new login.
- Updating a bank account does not create a second connected account.
- A `payout.failed` event changes the UI to an actionable remediation state.

## Frontend work

### Caller checkout

- Keep the existing compact authorization card.
- Pass `customerSessionClientSecret` into `<Elements>` only when present.
- Let the Payment Element render Link, saved methods, the save-consent checkbox, and method removal.
- Prefill the signed-in user's email for Link detection when Stripe's supported Element options allow it.
- Use clear copy: “Save for faster calls on Bling.” Do not imply that saving guarantees future authorization or capture.
- Preserve guest checkout and the current Back action.

### User payment settings

Add a **Payments** tab to the classic settings layout for signed-in users. It contains:

- saved-method cards with brand, last four, and expiration;
- default badge or “Make default” action if included in v1;
- Remove action with an inline confirmation;
- **Add payment method** opening an embedded Payment Element backed by a SetupIntent;
- empty, loading, error, expired-card, and success states.

The UI never renders raw Stripe Customer IDs, PaymentMethod IDs, or client secrets.

### Creator payout settings

Keep **Settings → Payouts** and make the main state explicit:

- **Not set up:** “Add bank account” primary action.
- **In progress:** show a short requirements summary and “Continue setup.”
- **Under review:** explain that Stripe is reviewing details and no action is required.
- **Ready:** show safe bank summary, next scheduled transfer, and “Update bank account.”
- **Needs attention:** show the actionable reason category and “Fix payout details.”

Use “Bling balance,” “Monthly transfer,” and “Bank payout” as distinct labels. Do not say money reached the bank until a signed `payout.paid` webhook confirms it.

## Security and privacy requirements

- Stripe Elements and Connect embedded components must own all card, CVC, bank, SSN, identity, and document inputs.
- Never send sensitive payment or identity values through Bling APIs, analytics, error reporting, session storage, local storage, logs, or database columns.
- Never log PaymentIntent, SetupIntent, Customer Session, or Account Session client secrets.
- Require authenticated ownership checks for every saved-method and creator-payout endpoint.
- Keep CSRF/origin protection on cookie-authenticated mutations and use `Cache-Control: no-store` for all secret-bearing responses.
- Verify Stripe webhook signatures against the raw body, claim event IDs idempotently, and support both platform and connected-account event destinations.
- Store an auditable version of Bling's payment-method consent copy or reconstruct the consent from Stripe's `allow_redisplay` state and documented UI version. Legal review must approve the final saved-payment and payout terms before production.
- Rate-limit customer/session/setup creation endpoints and cap outstanding unconfirmed SetupIntents.

## Performance and scaling

- Keep one platform Customer lookup row per user; index `stripe_customer_id` uniquely.
- Create Customer Sessions and SetupIntents on demand because their secrets are short-lived; never persist them.
- Avoid listing payment methods during anonymous discovery or before the payment panel opens.
- Cache only non-sensitive payout-status projections for a short interval and invalidate them after onboarding exit or relevant webhooks.
- Paginate payment methods and payout activity. Bound all Stripe calls with timeouts and retry only idempotent operations.
- Continue using database uniqueness plus Stripe idempotency; neither is sufficient alone for cross-system failure recovery.

## Test plan

### Unit and integration

- Customer creation concurrency and ambiguous-result recovery.
- Optional authentication on the public authorization route.
- Customer and Customer Session IDs always match.
- Cross-user list, detach, and default-method attempts are rejected.
- Guest, signed-in new card, signed-in saved card, and Link authorization paths.
- Manual capture, cancel, refund, and webhook replay remain idempotent.
- SetupIntent success, authentication-required, decline, and abandoned setup.
- Creator transfer and bank-payout capability combinations.
- Existing connected-account reuse and bank-account update.
- Payout failure disables readiness and successful remediation restores it.

### Browser and Stripe sandbox

1. Sign in, save a card during a paid-call authorization, leave the queue, and confirm the authorization is canceled while the saved method remains reusable.
2. Start another paid call with that saved card and confirm it reaches `requires_capture` and is captured only after creator selection.
3. Pay as a guest with Link and confirm no `user_payment_profiles` row is created.
4. Add and remove a card from Settings → Payments; refresh and verify the state comes from Stripe.
5. Complete creator onboarding with a Stripe test bank account; refresh and verify Ready persists.
6. Trigger `payout.failed`, verify Needs attention, replace the bank account, and confirm readiness recovers.
7. Run the existing monthly payout sandbox scenario and confirm one platform transfer and one later bank payout lifecycle.

## Rollout

1. Enable Link in the Stripe test payment-method configuration and confirm manual capture is supported for Bling's account and countries.
2. Deploy the additive migration and customer/payout projections with all new UX hidden behind `SAVED_PAYMENT_METHODS_ENABLED=false`.
3. Ship optional authenticated Customer attachment while saved-method display remains off; reconcile Customer mappings.
4. Enable Customer Sessions and save consent for staff/test accounts.
5. Release Settings → Payments and test deletion, default behavior, and repeat-call authorization.
6. Deploy explicit bank-payout readiness and safe bank summary; keep the existing embedded setup as fallback during rollout.
7. Run the full Stripe sandbox matrix, security review, consent-copy review, and finance reconciliation.
8. Enable progressively while monitoring authorization conversion, duplicate Customer count, SetupIntent failures, payout-readiness regressions, and webhook backlog.

Rollback disables saved-method UX and stops attaching new Customers. Existing PaymentMethods stay safely attached at Stripe and can be re-enabled later. Do not detach methods, delete Customer mappings, recreate connected accounts, or remove payout projections during rollback.

## Definition of done

- Signed-in users can deliberately save, reuse, view, and remove payment methods; guests can still use card or Link.
- No sensitive card or bank data crosses Bling's servers.
- Existing manual authorization, creator selection, capture, cancellation, refund, dispute, ledger, and monthly payout behavior remains correct.
- Creators can add or update a bank account inside the Payouts tab, and readiness persists across refreshes because it comes from Stripe.
- Backend, frontend, migration, unit, integration, and browser tests pass.
- Sandbox reconciliation proves that PaymentIntent, Customer, PaymentMethod, connected account, transfer, payout, and Bling ledger records agree.

## Stripe references

- [Save and retrieve customer payment methods](https://docs.stripe.com/payments/save-customer-payment-methods)
- [Save a payment method during a payment](https://docs.stripe.com/payments/save-during-payment?payment-ui=elements)
- [Setup Intents](https://docs.stripe.com/payments/setup-intents)
- [Link with a custom Elements integration](https://docs.stripe.com/payments/link/add-link-elements-integration)
- [Customer Sessions API](https://docs.stripe.com/api/customer_sessions/create)
- [Connect embedded account onboarding](https://docs.stripe.com/connect/supported-embedded-components/account-onboarding)
- [Payouts to connected accounts](https://docs.stripe.com/connect/payouts-connected-accounts)
- [Manage payout schedules](https://docs.stripe.com/connect/manage-payout-schedule)
- [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)

## Launch decisions that still require business approval

- Whether saved cards are strictly on-session for v1 or may be charged off-session later.
- Whether users can choose a default method in v1 or simply use Stripe's most-recent/default ordering.
- Whether creators receive automatic connected-account bank payouts monthly after Bling's transfer, or Bling explicitly creates each connected-account payout after transfer settlement.
- Final saved-payment consent wording, creator payout terms, tax reporting, reserve policy, and unclaimed-balance policy.

