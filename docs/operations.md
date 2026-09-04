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
6. Payout failed: direct the creator to update payout details through Stripe onboarding. Stripe disables the failed external account until corrected.
7. Dispute opened: investigate the call and Stripe evidence deadline. Destination-charge dispute amounts and fees are debited from the Bling platform balance; transfer recovery is a deliberate support action, not an automatic worker action.

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
