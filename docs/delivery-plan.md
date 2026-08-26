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
- Show-scoped event bus, presence, reconnect with jitter, and REST resynchronization
- Realtime queue updates in both clients

Acceptance: event tests and simulated slow/reconnecting clients show no blocked show fanout or leaked goroutines.

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
