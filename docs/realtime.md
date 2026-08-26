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

Supported types are `queue.joined`, `queue.left`, and `show.ended`.

## Delivery and recovery

Queue transactions write the existing PostgreSQL outbox. The outbox worker updates the Redis candidate index, coalesces each batch to at most one notification per show, publishes those show events, and only then acknowledges the records. A Redis failure therefore leaves the batch available for retry, while a caller burst does not become one WebSocket message per caller.

Redis Pub/Sub is intentionally ephemeral. Clients refetch REST state whenever a socket opens, after each valid event, and every 30 seconds as a safety net. Disconnects retry with exponential backoff, randomized jitter, and a 30-second ceiling. Missing events cannot corrupt queue state.

Each API instance creates at most one Redis subscription for an active show, regardless of how many local WebSocket clients are watching it. The local hub uses non-blocking bounded buffers; a slow client is disconnected and reconnects instead of blocking the show's fanout.

## Resource controls

The following environment variables bound resource use:

- `REALTIME_CONNECT_LIMIT`: connection attempts per authenticated viewer/creator identity, role, and show within the configured window; a broader IP guard also limits unauthenticated floods
- `REALTIME_RATE_LIMIT_WINDOW`: connection-attempt window
- `REALTIME_CLIENT_BUFFER`: pending events allowed per local client
- `REALTIME_MAX_PER_SHOW`: active connections allowed per show on one API instance
- `REALTIME_HEARTBEAT`: ping interval
- `REALTIME_WRITE_TIMEOUT`: event and ping deadline

Production ingress should also enforce connection and request admission before traffic reaches the API. Capacity is horizontal: load balancers distribute sockets across API instances, while Redis carries show events between those instances.
