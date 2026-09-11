# Operations runbook

## Reliability model

PostgreSQL remains authoritative for queue and call state. Redis carries disposable realtime fanout, candidate indexes, and participant presence leases. Every signaling socket owns a unique lease, so multiple browser tabs do not create false disconnects. Leases expire after `CALL_PRESENCE_TTL`; the API then records the disconnect in PostgreSQL. A reconnect clears that timestamp. If it remains set for `CALL_DISCONNECT_GRACE`, the call becomes `FAILED`, its queue entry becomes `ENDED`, and the normal outbox event wakes both clients.

API instance loss is safe: another instance reaps the global Redis deadline set, and PostgreSQL row locks with `SKIP LOCKED` make concurrent cleanup workers idempotent.

## Metrics and alerts

Scrape `GET /metrics`. It exposes aggregate gauges only:

- `bling_queue_waiting`
- `bling_calls_active`
- `bling_calls_in_reconnect_grace`
- `bling_queue_outbox_pending`
- `bling_payment_captures_pending`
- `bling_payment_refunds_pending`
- `bling_payment_refunds_failed`
- `bling_stripe_webhook_events_failed`
- `bling_payment_disputes_open`
- `bling_creator_payouts_failed`

Page when readiness fails for two minutes, the outbox backlog grows continuously for five minutes, any refund reaches `FAILED`, a supported webhook event remains `FAILED`, a dispute needs attention, or a creator payout fails. Investigate pending refunds that do not clear within ten minutes. Request latency and failures remain in structured API logs with request IDs.

## Failure recovery

1. PostgreSQL unavailable: stop mutations, keep readiness failed, restore PostgreSQL, and verify the outbox drains.
2. Redis unavailable: signaling and queue notifications reconnect with jitter; PostgreSQL queue data remains intact. Restore Redis and restart an API instance only if subscriptions do not recover.
3. API instance terminated: the load balancer removes it through readiness; clients reconnect to another instance. Presence TTL plus grace cleans abandoned calls.
4. TURN unavailable: direct connections may still work, but symmetric-NAT callers fail. Restore TURN and verify newly issued credentials using an authorized RTC-config request.
5. Refund failed: inspect the Stripe request log using the refund request's stable idempotency key, restore platform balance or provider connectivity, and reconcile the request before issuing any manual refund.
6. Payout failed: direct the creator to update payout details through Stripe onboarding. Stripe disables the failed external account until corrected. If account creation itself fails, read the structured log: payout failures now record Stripe's error type, code, HTTP status and request ID, and `PAYOUTS_MISCONFIGURED` means the platform's own Stripe setup is at fault and the creator retrying cannot help.
7. Dispute opened: investigate the call and Stripe evidence deadline. Destination-charge dispute amounts and fees are debited from the Bling platform balance; transfer recovery is a deliberate support action, not an automatic worker action.

## Social discovery

Schema, API contracts, and design rationale are in [social-architecture.md](social-architecture.md). This section is the operational summary.

### Setup and configuration

Social routes ship inside the existing API binary and add no new infrastructure. Apply migration `000010` before deploying the new API; the schema is additive, so already-running API instances stay compatible during the rollout. Deploy the frontend last.

- `SOCIAL_TRUSTED_PROXY_CIDRS`: comma-separated ingress CIDRs whose `X-Forwarded-For` may be trusted for per-IP social rate limits. Empty means forwarding headers are ignored and every proxied user shares the proxy's bucket. Never set this to the whole Internet. It applies only to the social routes; existing auth and call controls keep their original configuration.
- `COOKIE_SECURE=true` and exact HTTPS `ALLOWED_ORIGINS` are required in production. The anonymous presence cookie is HttpOnly and follows the same settings.
- Size pgx `pool_max_conns` in the DSN across replicas. The social worker runs inside every API replica and shares the pool with the existing call and finance workers.
- Redis is a shared single-node dependency, not Redis Cluster. Social caching, rate limiting, and presence all use it.

Rate limits are shared in Redis: 600 requests/minute per client IP, 60 follow writes/minute per user, 20 profile saves/minute per user, 120 read-receipt writes/minute per user, and 6 presence heartbeats/minute per actor and channel. These do not alter the existing call or payment endpoints.

### Metrics and alerts

`GET /metrics` adds:

- `bling_social_cache_hits_total`, `bling_social_cache_misses_total`
- `bling_social_presence_writes_total`
- `bling_social_projection_batches_total`
- `bling_social_errors_total`
- `bling_social_projection_pending`, the number of dirty creators awaiting projection
- `bling_social_projection_oldest_seconds`, the age of the oldest unprocessed marker

Page when `bling_social_projection_oldest_seconds` stays above 60 for five minutes, because follower totals are then visibly stale. Investigate when `bling_social_projection_pending` grows continuously across ticks, when `bling_social_errors_total` rises steadily, or when social `429`/`503` rates climb. The five-second projection tick is a normal low-backlog interval, not a maximum-lag guarantee. Also watch social query p95, pool waits, Redis memory and evictions, and retention age. No high-cardinality user or creator labels were added; keep `/metrics` restricted at the ingress.

### Failure recovery

1. Redis unavailable: social requests fail with `503` because rate limits cannot be enforced. Follow relationships and notification state in PostgreSQL are unaffected; directory caches and presence counts rebuild once Redis returns. Full social availability during a Redis outage is not claimed.
2. Projection backlog growing: confirm at least one API replica is running its worker, then check pool waits and lock contention on `social_dirty_creators`. Follower totals lag, but follow relationships stay correct because they commit synchronously.
3. Stale public metadata: a failed cache invalidation can leave public directory entries stale until the 20-second TTL expires. No action is required; investigate only if staleness outlives the TTL.
4. Implausible presence counts: counts are an approximate activity indicator of channel-page visitors, not broadcast viewers. Separate browsers, cleared cookies, and bots inflate anonymous counts. Never use them for billing, audience verification, or fraud analysis.
5. Retention falling behind: cleanup removes at most 5,000 expired read receipts and then 1,000 expired events per minute. Logical filtering always hides events older than 30 days, so viewers keep seeing correct feeds while physical cleanup catches up. Sustained growth needs dedicated retention workers or partitioning.

### Scaling limits

Notification reads are the first expansion point. A viewer's unread query visits up to 1,000 followed creators and may inspect already-read history before finding unread events; the response size and follow count are bounded, but the scanned work is not constant. Measure this workload before fan-in grows, then add a per-user inbox or read watermark, or hybrid asynchronous fanout. One creator's presence set and 64 follower-counter shards are also finite boundaries. Going live costs a fixed amount of work regardless of follower count and never walks the follower list.

Recorded latencies come from local service measurements with warm caches, documented in [social-architecture.md](social-architecture.md). They are not production HTTP capacity, and this implementation promises neither unlimited scale nor multi-region consistency.

### Rollback

Roll back only when the latest applied version is 10, after deploying the previous frontend and API or stopping social readers and workers. Back up the social tables first if their contents must be retained.

```sh
docker compose run --rm migrate down 1
```

The down migration drops profiles, follows, follower shards, dirty markers, live events, and read receipts, along with their triggers and indexes. Accounts, shows, queues, calls, and payments are preserved. Reapplying recreates profiles from existing accounts but cannot restore dropped follows or read receipts. Do not roll back merely to restart a server.

Verified on 2026-09-10 against an isolated `bling_social_test` database: `down 1` returned the schema to version 9 and left no social table, trigger, or function behind, with core tables intact; `up` restored version 10 with every social object and trigger recreated. Both directions completed in well under a second on an empty database. Assess real duration on a production-size copy, because the backfill, index creation, and trigger installation take locks.

## Load smoke

Create a live show, then hold hundreds of authenticated queue sockets:

```sh
cd backend
go run ./cmd/queue-load -show <show-uuid> -callers 500 -concurrency 100 -websockets -hold 60s
```

The command exits non-zero for failed joins or WebSocket handshakes and reports join latency, throughput, and the number of live sockets. Run this against a non-production environment with realistic API/Redis/PostgreSQL instance counts.

## Security checklist

- Production requires secure cookies, an explicit origin allowlist, TURN, and `TURN_SHARED_SECRET`.
- RTC configuration is authorization-gated, non-cacheable, and returns per-participant coturn REST credentials with a short expiry.
- Never log viewer recovery cookies, TURN credentials, signaling SDP, or ICE payloads.
- Rate limits and bounded per-show/per-call hubs remain enabled; load-test traffic needs deliberate environment-specific limits.
- Rotate the TURN shared secret by accepting old and new secrets at coturn during the credential TTL, deploying the new API secret, then removing the old one.
- Social routes trust `X-Forwarded-For` only from `SOCIAL_TRUSTED_PROXY_CIDRS`. Leave it empty rather than guessing, and have the ingress replace or safely append the header. Public social responses exclude email, password hashes, sessions, and payment data, and are sent with `Cache-Control: no-store`.
