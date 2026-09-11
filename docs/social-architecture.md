# Social architecture

Implemented in migration `000010`, `backend/internal/social`, `backend/internal/httpapi/social.go`, and `frontend/src/lib/social.ts`. PostgreSQL is authoritative. Redis is used for shared caches, rate limits, and expiring presence. No additional infrastructure or dependencies were introduced.

## Accounts and identity

The existing account/session system serves both viewers and creators. A user insert initializes an unlisted profile transactionally. Publishing a profile or creating a show makes the account discoverable; a live profile cannot be unpublished. All pre-migration users are backfilled as published creators because the original registration flow was creator-only. No existing call, queue, tier, Stripe, or payout lifecycle logic was changed.

Public responses contain only the profile ID, username, display name, bio, avatar/cover URLs, category, publication/live state, follower count, follow flag, and visitor count. Email, password hashes, sessions, and payment information are excluded. Usernames retain the existing immutable 3–30-character convention. Images are HTTPS URLs supplied by the creator; the API does not fetch remote images. Browser requests omit referrers and render initials when images fail. An upload/CDN pipeline and content moderation are separate work.

## Database and concurrency

| Relation | Purpose and access path |
| --- | --- |
| `creator_profiles` | Public projection; partial live/follower/UUID ranking indexes, category ranking index, GIN full-text search index |
| `creator_follows` | Unique `(follower_id, creator_id)` relationship, both-direction indexes, cascading foreign keys, no self-follow |
| `creator_follower_shards` | 64 transactional counter shards per creator; avoids one counter row receiving every follow write |
| `social_dirty_creators` | Durable, age-ordered projection work, one row per dirty creator |
| `creator_live_events` | One durable event per show, unique show ID, indexed creator/time/ID and retention time |
| `notification_reads` | Unique per-user/event receipt; indexed event ID for cleanup |

Follow and unfollow are idempotent target-state operations, not toggles. A per-viewer transaction advisory lock protects the 1,000-follow limit under concurrency. It does not serialize every viewer of a creator. Database constraints enforce uniqueness and self-follow protection even for direct writes.

A trigger adjusts a counter shard and marks the creator dirty in the same transaction as a follow. Writers share-lock their marker; workers exclusively lock batches of 100 with `SKIP LOCKED`. If a worker deletes the marker before a waiting writer locks it, that writer re-inserts it. This prevents lost updates while allowing concurrent writers. Show projection follows the same marker-before-profile lock order. The worker sums the 64 shards, updates the profile total, deletes the markers, and invalidates directory caches after commit.

Show status triggers update the profile and insert the unique live event inside the existing show transaction. Failed/rolled-back starts cannot emit an event. Repeated starts do not create duplicate notifications. The go-live write performs a fixed amount of work regardless of follower count; it never walks all followers. Existing live shows are backfilled in profiles without inventing historical notifications.

## API contracts

All responses use `{ "data": ... }`; errors use the existing structured error envelope. Social responses set `Cache-Control: no-store`. Requests have a three-second work deadline. POST bodies require JSON; the existing origin protection and request-body limit still apply.

| Method and route under `/api/v1` | Access | Result |
| --- | --- | --- |
| `GET /creators` | Public | `{items, nextCursor?}`; optional `q`, `category`, `live`, `limit`, `cursor` |
| `GET /creators/:username` | Public; unlisted visible only to owner | Profile |
| `GET /profile` | Signed in | Own profile |
| `POST /profile` | Signed in | Updated profile; body: `displayName`, `bio`, `avatarUrl`, `coverUrl`, `category`, `published` |
| `POST /creators/:username/follow` | Signed in | `{isFollowing:true}`; body `{}` |
| `DELETE /creators/:username/follow` | Signed in | `{isFollowing:false}` |
| `GET /following` | Signed in | Same filters/page contract, scoped to the session user |
| `GET /following/count` | Signed in | `{count}` |
| `GET /notifications` | Signed in | `{items, nextCursor?, unreadCount, unreadCapped}`; optional `cursor` |
| `POST /notifications/read` | Signed in | 204; body `{ids:["event-id"]}` with 1–50 string IDs |
| `POST /creators/:username/presence` | Public, live channel only | `{channelVisitors, expiresInSeconds:90}`; body `{}` |

Directory pages default to 24, maximum 50. Cursors encode `(is_live, follower_count, user_id)` and the filter scope. They are validated and opaque to clients, but not signed capabilities: every query independently reapplies authorization and filters. Full-text search matches complete tokens in username, display name and bio, using PostgreSQL `simple` text search; it is not fuzzy autocomplete. Maximum query length is 80 characters. Supported categories are Just chatting, Music, Gaming, Creative, and Tech.

Notifications are 24 per page, sorted by event time and ID. A viewer sees events in the last 30 days created since their current follow began, from currently followed published creators. Unfollowing removes these updates from the feed; re-following starts a new window. At most 25 recent indexed events are selected per followed creator before global pagination. Unread counts stop at 100 and expose `unreadCapped`; they are not claimed as exact above that threshold. Read writes verify the same relationship/window and cannot mark another person's inaccessible events. JSON event IDs are strings to preserve 64-bit precision.

## Consistency and caching

- Follow relationships and notification read state are committed before success. The UI changes immediately, disables conflicting follow mutations, restores its prior state on failure, and refetches on settlement.
- Totals are eventually projected every five seconds in batches of 100. Five seconds is a normal low-backlog interval, not a maximum-lag guarantee. Popularity uses actual follows; live creators sort first. Rank changes during pagination can move records across pages; the client deduplicates and refreshing starts a new traversal.
- Only public, fixed-size first pages with no search are shared in Redis. Category/live variants are finite; arbitrary queries and private following feeds are not shared. Entries expire after 20 seconds; a shared version invalidates them after profile writes and projection batches. A failed invalidation can leave public metadata stale until TTL. Public URLs and listings have eventual publication changes within this window.
- Follow flags and visitor counts are attached after cache retrieval, with one batched PostgreSQL lookup and a Redis pipeline. Shared cached payloads never contain personalized follow state. Local single-flight coalesces concurrent cache misses without sharing a caller's cancellation or mutable profile slices.
- React Query keys include account identity. Logout cancels/removes social caches. Polling is normally every 30 seconds while active; this is not instantaneous push. The client retains at most ten pages per feed to bound polling and browser memory. Server-backed follows survive reloads and devices.

## Presence and abuse controls

A per-show Redis sorted set stores an authenticated-user hash or a random HttpOnly browser-cookie hash with heartbeat timestamps. Multiple tabs for the same actor deduplicate. Visible pages heartbeat every 30 seconds; 90-second expiry removes abandoned visitors without relying on unload. At most 100 stale members are removed per heartbeat, and the whole key expires after inactivity. Counts include only timestamps within the TTL, even before physical removal. Different browsers, cleared cookies, and bots can inflate anonymous counts: this is an approximate activity indicator, not billing, verified audience size, or fraud-resistant analytics. It does not join the caller queue or activate a microphone.

Social rate limits are shared in Redis: 600 requests/minute per client IP; 60 follow writes/minute per user; 20 profile saves/minute per user; 120 read-receipt writes/minute per user; 6 heartbeats/minute per actor/channel. A Redis rate-limit outage fails social requests with 503; rejected limits return 429 with `Retry-After`. No claim of full social availability during a Redis outage is made. These limits do not alter the existing call/payment endpoints.

Behind a reverse proxy, configure `SOCIAL_TRUSTED_PROXY_CIDRS` to the exact ingress ranges and have the ingress replace or safely append `X-Forwarded-For`. The API walks the chain from the trusted socket peer to the first untrusted address. With an empty setting it ignores forwarding headers. Do not trust the entire Internet. Without this configuration, proxied users share the proxy's IP bucket. This setting applies only to new social routes; existing auth/call controls retain their original configuration. Set `COOKIE_SECURE=true` and exact HTTPS `ALLOWED_ORIGINS` in production.

## Background work and operations

The existing API process starts the social worker. Multiple replicas coordinate via PostgreSQL locks; no dedicated broker is required. Each replica handles up to 100 dirty creators per five-second tick. Provision database pool limits explicitly (pgx `pool_max_conns` in the DSN) across replicas; account for the existing call/finance workers too. Redis is a shared dependency and the current client is single-node, not Redis Cluster.

Retention runs once per minute, deletes at most 5,000 expired read receipts and then at most 1,000 expired events without remaining receipts. This bounds deletion work even for a heavily followed creator. Logical notification filtering always hides events older than 30 days, independently of physical cleanup progress. Large receipt volumes may need dedicated retention workers/partitioning; size this throughput against actual production event/read rates.

`/metrics` adds cache hit/miss, presence-write, projection-batch and error counters, plus pending creator count and oldest marker age. Existing access logs report request status and duration. Monitor projection age/backlog, social 429/503/5xx, query p95, pool waits, Redis memory/evictions, and retention age. Restrict the existing metrics endpoint at the ingress. No high-cardinality user/creator metric labels were added.

At very large fan-in, notification reads become the first expansion point: they visit up to 1,000 creators per viewer, and the unread query may inspect more already-read history before finding unread events. The return size and follow count are bounded, but that does not make all scanned work constant. Add a per-user inbox/read watermark or hybrid asynchronous fanout after measuring this workload. One creator's presence set and 64 counter shards also remain finite scaling boundaries. This implementation does not promise unlimited scale or multi-region consistency.

## Migration and rollback

Back up the database first. Apply migration 10 before deploying the new API, then deploy the frontend. The schema is additive and existing API instances remain compatible. Backfill/index creation and trigger installation take locks, so assess migration duration on a production-size copy and deploy in a suitable window. No production system was deployed by this task.

Local commands from the repository root:

```sh
docker compose up -d postgres redis
docker compose run --rm migrate up
```

For rollback, first deploy the previous frontend/API or stop social readers/workers, and back up the social tables if their data must be retained. Then, only when the latest version is 10:

```sh
docker compose run --rm migrate down 1
```

This drops social profiles, follows, notifications and read state; it preserves original accounts, shows, queues, calls and payments. Reapplying recreates profiles from accounts but cannot restore dropped follows/read state. Do not roll back just to restart a server.

The local `bling` database was backed up to `/private/tmp/bling-before-social-20260910.dump` and migrated to version 10 on 2026-09-10. The existing API on 8080 and previews on 5173 were left running because an active call was present. The updated preview is `http://127.0.0.1:5174/`, with its API on 18081. Both use the actual local database. For the same temporary arrangement:

```sh
# Terminal 1, backend/
HTTP_ADDR=127.0.0.1:18081 ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5174 FRONTEND_URL=http://127.0.0.1:5174 go run ./cmd/api
# Terminal 2, frontend/
VITE_API_PROXY_TARGET=http://127.0.0.1:18081 npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Once existing calls have finished, the normal API restart on 8080 makes the original 5173 preview use the new API as well. No environment secrets were changed.

## Verification and measurements

Use an isolated test database migrated to version 10. Never run the opt-in load test against real app data.

```sh
# backend/
TEST_DATABASE_URL='postgres://bling:bling@127.0.0.1:5432/bling_social_test?sslmode=disable' \
TEST_REDIS_URL='redis://127.0.0.1:6379/15' go test -race -p 1 ./...

RUN_SOCIAL_LOAD=1 \
TEST_DATABASE_URL='postgres://bling:bling@127.0.0.1:5432/bling_social_test?sslmode=disable' \
TEST_REDIS_URL='redis://127.0.0.1:6379/15' go test ./internal/social -run TestSocialLoad -count=1 -v

# frontend/
npm test -- --run
npm run build
npm run lint
```

`TestSocialLoad` refuses databases other than `bling_social_test` or `bling_social_load`. It creates and cleans up 10,000 synthetic public profiles, a viewer with 1,000 follows, and 200 events, then measures concurrency 16 with 500–1,000 requests per scenario. It checks the follow cap and prints `EXPLAIN (ANALYZE, BUFFERS)` plans. The 2026-09-10 local Docker PostgreSQL 16 / Redis 7 measurements were:

| Service operation | p50 | p95 | Observed operations/s |
| --- | ---: | ---: | ---: |
| Cached public directory | 2.76 ms | 6.79 ms | 4,832 |
| Following, 1,000 follows | 6.89 ms | 12.43 ms | 1,937 |
| Notifications, 1,000 follows/200 events | 71.18 ms | 108.60 ms | 213 |
| Follow/unfollow writes | 22.45 ms | 33.06 ms | 693 |

Directory/category plans used a ranking index; search used the GIN index. These are local service/repository measurements with warm caches, not HTTP/TLS, authentication, gateway rate limits, geographic traffic, sustained soak, or production-capacity guarantees. The real HTTP journey separately verified session cookies, registration, profile publication, private-field exclusion, follow idempotency, existing show routes, go-live, browser presence deduplication, notification read persistence, end, unfollow and logout. Database tests cover rollback atomicity, privacy, concurrent counts, the worker race, pagination and retention. Existing business regression tests continue to pass.
