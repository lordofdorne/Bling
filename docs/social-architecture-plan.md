# Approved social architecture implementation

Status: implemented and verified locally on 2026-09-10. User approved this scope on 2026-09-09 and asked that it be saved before implementation. Continue until implemented and verified; do not treat a context reset as completion.

## Scope approved by the user

- [x] Real viewer accounts and public creator profiles (display name, bio, avatar, cover, categories), preserving existing creators and anonymous callers.
- [x] PostgreSQL follows with foreign keys, uniqueness, bidirectional indexes, counts, follow status, idempotent writes, and no self-following.
- [x] Real creator discovery with search, category/live filters, public-only responses, real channel links, and pagination.
- [x] Following feed with live creators first, cross-device persistence, optimistic UI and failure recovery.
- [x] Real show-derived live status and activity-derived popularity; Redis expiring/deduplicated page presence, accurately labeled as channel visitors rather than broadcast viewers.
- [x] Durable in-app live notifications, unread state, marking read, without synchronous follower-wide fanout on go-live.
- [x] Cursor pagination, bounded indexed/batched queries, deliberate shared caching/invalidation, PostgreSQL authority and ephemeral Redis state.
- [x] Authentication/authorization, input validation, and rate limits for mutations, search and presence; preserve payment/queue/call protections.
- [x] Migration/rollback instructions, concurrency and integration tests, query/load measurements, metrics and honest scaling limits.
- [x] Replace all mocks/local-only follow state with API integration and loading/empty/error/retry states, preserving the visual design.

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
7. Full real HTTP journey passed end to end against the local database: account creation, profile publication, following, going live, notifications, and marking updates read.
8. Local `bling` database backed up and migrated to version 10. The temporary preview on 5174 with its API on 18081 runs against that database while an existing call remains active on the original 8080/5173 pair.
9. Browser review of the preview completed for the public surface: discovery listing with real profiles, full-text search, the no-results empty state, channel pages, presence counts rendering as "on this channel page", signed-out follow controls degrading to sign-in links that preserve `next`, the signed-out following prompt, and the mobile layout. The presence heartbeat correctly stayed silent while the automation tab reported `visibilityState: hidden`, and the endpoint itself was verified separately: per-actor deduplication, distinct actors incrementing, and `409 HOTLINE_CLOSED` on an offline channel. The only console error was the pre-existing signed-out `GET /api/v1/me` 401; no social endpoint is called while logged out.
10. Rollback rehearsed on the isolated `bling_social_test` database: `down 1` reached version 9 leaving no social object behind with core tables intact, `up` restored version 10 in full, and the real `bling` database stayed at version 10 throughout.
11. Operational documentation completed: a social section in `docs/operations.md` covering setup and configuration, metrics and alert thresholds, failure recovery, scaling limits and rollback; a social security checklist entry; README feature and isolated-migration notes; and the verified rollback evidence recorded in `docs/social-architecture.md`.
12. Remaining: signed-in views have been verified over HTTP and in component tests but not yet reviewed in a browser, because signing in requires the user to enter credentials. No production deployment was requested.
