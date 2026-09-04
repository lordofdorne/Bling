# Bling delivery plan

Each pull request should be independently reviewable, tested, and small enough to revert without destabilizing unrelated product behavior.

## PR 1 — Foundation

- Isolated monorepo and local developer workflow
- React, TypeScript, Vite, React Router, and TanStack Query shell
- Go API with configuration, structured logging, request IDs, and graceful shutdown
- PostgreSQL and Redis through Docker Compose
- Initial domain schema and liveness/readiness checks

Acceptance: frontend and backend build; unit tests and Go race detector pass; readiness reflects dependency availability.

## PR 2 — Review workflow

- Pull request template for scope, verification, operational impact, and deferred work
- Clean foundation handoff for subsequent product slices

Acceptance: every new PR opens with the same production review checklist.

## PR 3 — Creator authentication

- Register, login, logout, and `/api/v1/me`
- Password hashing, opaque server-side sessions, secure cookies, CSRF protection, validation, and auth rate limiting
- Login/register screens and protected dashboard route

Acceptance: auth handler and session tests cover valid, invalid, expired, and unauthorized behavior.

## PR 4 — Show lifecycle

- Create, start, inspect, and end a show
- Ownership checks and one-live-show invariant
- Creator dashboard controls and `/u/:username` closed/live states

Acceptance: concurrent start attempts cannot create two live shows.

## PR 5 — Durable caller queue

- Anonymous viewer identity token and hashed recovery credential
- Join, leave, current position, and creator queue endpoints
- Explicit queue state machine, tier/duration snapshots, and sequence-based transactional ordering
- PostgreSQL source of truth with a Redis sorted-set candidate index and transactional repair outbox
- Caller form and creator queue UI using authoritative REST state with bounded polling
- Configurable HTTP queue load driver

Acceptance: refresh recovers queue state; viewers cannot inspect other callers; concurrent retries are idempotent; Redis failures fall back to PostgreSQL; integration, transition, and 1,000-caller load smoke tests pass.

## PR 6 — Realtime transport

- Bounded WebSocket hub, one writer per connection, heartbeat, deadlines, origin checks, and rate limits
- One Redis Pub/Sub subscription per active show and API instance, with non-blocking local fanout
- Authenticated viewer/creator connections, reconnect with jitter, and REST resynchronization
- Realtime queue updates in both clients

Acceptance: cross-instance event tests and 500-client simulations show no blocked show fanout; slow clients are disconnected; empty rooms release subscriptions; reconnecting clients resynchronize from REST.

## PR 7 — Atomic caller selection and signaling

- Transactional selection with exactly one active-call winner
- Active call state machine and scoped WebRTC signaling messages
- Concurrent selection test

Acceptance: simultaneous selections produce one winner and signaling never reaches unrelated users.

## PR 8 — Audio call experience

- Focused WebRTC call manager, configured ICE servers, trickle ICE, and microphone UX
- Caller connect/retry flow, creator controls, state synchronization, and complete media teardown
- Tests for microphone denial, ending, failure, and reconnect recovery

Acceptance: the two-browser audio scenario works and every exit path stops local tracks.

## PR 9 — Reliability and operational polish

- Disconnect grace periods and timeouts for stale streamer/caller sessions
- Load simulator for hundreds of queued WebSocket clients
- Security review, mobile caller polish, desktop creator polish, and runbook updates

Acceptance: race detector and load smoke test pass; defined failure scenarios recover to authoritative state.

## PR 10 — Host-configurable tiers

- Durable draft Hotline recovery and creator tier editor
- Ordered server-derived priority, enable/disable controls, duration, and future price
- Immutable price/duration/priority snapshots on queue admission
- Caller tier selection with explicit no-payment messaging

Acceptance: configuration/start races serialize on the show row; live tiers cannot change; callers receive exactly the enabled ordered configuration and queue entries preserve its admission-time values.

## PR 11 — Stripe authorization and capture

- Stripe Payment Element with card-only manual-capture PaymentIntents
- Server-priced, viewer-bound authorization before paid queue admission
- Per-show payment reservation and idempotent capture before caller selection becomes visible
- Signed webhook reconciliation for captured, canceled, and failed intents
- Authorization release when a caller leaves, with free tiers available when Stripe is disabled

Acceptance: a paid caller cannot enter with a missing, reused, wrong-tier, wrong-viewer, or wrong-amount authorization; concurrent selections cannot double-charge; signaling remains unavailable until capture succeeds; Stripe test mode exercises authorize, leave/cancel, and select/capture.

## PR 12 — Stripe Connect creator payouts

- Stripe Express onboarding and signed account capability reconciliation
- Creator-controlled per-tier pricing with paid-tier readiness gates
- Destination charges to the creator's connected account
- Immutable 30% Bling application-fee snapshot and verification
- Dashboard payout status and onboarding recovery

Acceptance: paid Hotlines cannot start without a payout-ready creator; each PaymentIntent is bound to the snapshotted connected account and whole-cent 30% fee; free tiers remain usable without Stripe; repeated onboarding requests reuse one connected account.

## PR 13 — Financial recovery

- Durable, idempotent Stripe webhook event claims across API instances
- Automatic full refunds for captured calls that never reach `LIVE`
- Creator-transfer reversal and application-fee refund on every automatic refund
- Retryable refund worker with terminal failure visibility
- Dispute and connected payout event reconciliation
- Creator payment activity, payout-failure warnings, and operational metrics

Acceptance: terminating an unopened captured call commits exactly one refund request; repeated workers and webhook deliveries cannot create duplicate refunds; calls that reached `LIVE` are not automatically refunded; dispute, payout failure, and refund status are creator-scoped and observable.
