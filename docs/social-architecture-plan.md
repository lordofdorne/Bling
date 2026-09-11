# Approved social architecture implementation

Status: in progress. User approved this scope on 2026-09-09 and asked that it be saved before implementation. Continue until implemented and verified; do not treat a context reset as completion.

## Scope approved by the user

- [ ] Real viewer accounts and public creator profiles (display name, bio, avatar, cover, categories), preserving existing creators and anonymous callers.
- [ ] PostgreSQL follows with foreign keys, uniqueness, bidirectional indexes, counts, follow status, idempotent writes, and no self-following.
- [ ] Real creator discovery with search, category/live filters, public-only responses, real channel links, and pagination.
- [ ] Following feed with live creators first, cross-device persistence, optimistic UI and failure recovery.
- [ ] Real show-derived live status and activity-derived popularity; Redis expiring/deduplicated page presence, accurately labeled as channel visitors rather than broadcast viewers.
- [ ] Durable in-app live notifications, unread state, marking read, without synchronous follower-wide fanout on go-live.
- [ ] Cursor pagination, bounded indexed/batched queries, deliberate shared caching/invalidation, PostgreSQL authority and ephemeral Redis state.
- [ ] Authentication/authorization, input validation, and rate limits for mutations, search and presence; preserve payment/queue/call protections.
- [ ] Migration/rollback instructions, concurrency and integration tests, query/load measurements, metrics and honest scaling limits.
- [ ] Replace all mocks/local-only follow state with API integration and loading/empty/error/retry states, preserving the visual design.

Outside scope: video streaming, public audio broadcasting, chat, email/push notifications, personalized recommendation engine.

## Implementation notes and handoff

- Existing stack: Go/chi, PostgreSQL/pgx, Redis, React Query. Current migrations end at 000009.
- Starting worktree is clean; previous UI redesign is committed. No AGENTS.md found in repo inventory.
- Do not change existing financial or caller lifecycle semantics.
- Plan execution details, decisions, commands, test evidence, and outstanding work will be recorded below.

## Progress

1. Implemented migration 000010 and the Go social store/service/API. Profiles, follows, live events and read receipts use PostgreSQL. Redis holds cache and expiring channel-page presence.
2. Replaced fixture discovery, device-local follows, and example notifications with API-backed React Query hooks. Added creator profile editing and viewer sign-in continuation.
3. Frontend: 33 tests passed; build and lint passed. Existing call/queue/payment/auth regressions remain intact.
4. Full backend suite including database integration and race detector passed. Added concurrency, cache isolation, notification pagination/retention and HTTP authorization tests.
5. Fixed and regression-tested the dirty-marker deletion/concurrent-follow race using shared writer locks and exclusive worker locks. Lock order is dirty marker before profile updates.
6. Opt-in load test passed with 10,000 synthetic public profiles, 1,000 follows/viewer, 200 live events and concurrency 16. p95: cached directory 6.79ms, following 12.43ms, notifications 108.60ms, follow writes 33.06ms. These are local service measurements, not production HTTP capacity. Fixture cleanup succeeded.
7. Remaining: full real HTTP journey, final rollback/reapply check, local app migration/server refresh, browser review, operational documentation. No production deployment requested.
