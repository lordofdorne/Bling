# Realtime transport

Realtime is a notification layer, not a second source of truth. PostgreSQL owns queue state and ordering. A WebSocket event tells a client that its authorized REST view may have changed; the client then refetches that view.

## Connection endpoints

- Viewer: `GET /api/v1/shows/{showID}/queue/events`
- Creator: `GET /api/v1/shows/{showID}/queue/creator-events`

The viewer endpoint requires a valid anonymous queue recovery cookie for a waiting entry. The creator endpoint requires a valid creator session and ownership of the show. Browser origins pass through the same allowlist as REST requests and are checked again during the WebSocket handshake.

Events intentionally contain no caller names, topics, credentials, or payment data:

```json
{
  "type": "queue.joined",
  "showId": "2a31c34b-1f3d-46c7-8b37-25ebd6308562",
  "occurredAt": "2026-08-25T20:00:00Z"
}
```

Supported invalidation types are `queue.joined`, `queue.left`, `call.selected`,
`call.connecting`, `call.live`, `call.ended`, `call.failed`, and `show.ended`.

## Private call signaling

WebRTC negotiation uses a separate call-scoped channel. It is deliberately not
broadcast into the show's queue room:

- Selected caller: `GET /api/v1/shows/{showID}/calls/{callID}/signals`
- Creator: `GET /api/v1/shows/{showID}/calls/{callID}/creator-signals`

The caller endpoint checks the anonymous recovery credential against the call's
selected queue entry. The creator endpoint checks both the authenticated owner
and the call's show. Each API instance multiplexes local participants over one
Redis subscription per active call. The hub filters by both call ID and target
role, so an offer or ICE candidate cannot reach another caller or another show.

Creators may send `signal.offer` and `signal.ice`; selected callers may send
`signal.ready`, `signal.answer`, and `signal.ice`. The ready message is repeated
until the caller receives an offer, preventing a creator from publishing an
ephemeral offer before the caller has granted microphone access. The server derives `from`, `target`, and
`callId` from the authenticated socket rather than trusting those client fields.
Messages are limited to 64 KiB and carry opaque, validated JSON payloads. SDP
and ICE are ephemeral; PostgreSQL remains authoritative for the call lifecycle.
Connection attempts use the realtime identity/IP rate limits, and each API
instance admits at most eight local sockets for one call so abandoned tabs
cannot grow a room without bound.

ICE configuration is returned only after the same active-call authorization:

- Selected caller: `GET /api/v1/shows/{showID}/calls/{callID}/rtc-config`
- Creator: `GET /api/v1/shows/{showID}/calls/{callID}/creator-rtc-config`

Responses are non-cacheable. TURN credentials come from backend environment
configuration and are never compiled into the frontend bundle.

## Delivery and recovery

Queue transactions write the existing PostgreSQL outbox. The outbox worker updates the Redis candidate index, coalesces each batch to at most one notification per show, publishes those show events, and only then acknowledges the records. A Redis failure therefore leaves the batch available for retry, while a caller burst does not become one WebSocket message per caller.

Redis Pub/Sub is intentionally ephemeral. Clients refetch REST state whenever a socket opens, after each valid event, and every 30 seconds as a safety net. Disconnects retry with exponential backoff, randomized jitter, and a 30-second ceiling. Missing events cannot corrupt queue state.

Each API instance creates at most one Redis subscription for an active show, regardless of how many local WebSocket clients are watching it. The local hub uses non-blocking bounded buffers; a slow client is disconnected and reconnects instead of blocking the show's fanout.

Private call sockets also renew unique TTL presence leases. A global Redis deadline set lets any API instance discover sockets lost during a process or network failure. Redis presence is ephemeral; PostgreSQL stores the disconnect grace deadline and owns the final call transition.

## Resource controls

The following environment variables bound resource use:

- `REALTIME_CONNECT_LIMIT`: connection attempts per authenticated viewer/creator identity, role, and show within the configured window; a broader IP guard also limits unauthenticated floods
- `REALTIME_RATE_LIMIT_WINDOW`: connection-attempt window
- `REALTIME_CLIENT_BUFFER`: pending events allowed per local client
- `REALTIME_MAX_PER_SHOW`: active connections allowed per show on one API instance
- `REALTIME_HEARTBEAT`: ping interval
- `REALTIME_WRITE_TIMEOUT`: event and ping deadline

Production ingress should also enforce connection and request admission before traffic reaches the API. Capacity is horizontal: load balancers distribute sockets across API instances, while Redis carries show events between those instances.
