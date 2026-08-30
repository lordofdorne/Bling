# Audio call operation

Bling audio is a direct, one-to-one WebRTC connection. The Go API transports
only authorization, lifecycle state, SDP, and ICE candidates; it never receives
or proxies microphone audio.

## ICE configuration

Configure the API with:

- `STUN_URLS`: comma-separated STUN URLs
- `TURN_URL`: production TURN URL
- `TURN_USERNAME`: TURN username
- `TURN_CREDENTIAL`: TURN credential

Development defaults to Google's public STUN service. Production startup
requires TURN because STUN-only calls cannot connect reliably across restrictive
NATs. The current variables support a static relay account; replace this with
short-lived provider credentials before exposing a shared production account at
large scale.

The API returns ICE servers only to the authenticated creator or selected
anonymous caller of an active call, with `Cache-Control: no-store`.

## Two-browser local test

1. Run `make db-up`, `make migrate`, `make dev-api`, and `make dev-web`.
2. Register a creator, start a Hotline, and copy the `/u/{username}` path.
3. Open that path in a private browser window, join the queue, then select that
   caller from the creator dashboard.
4. Click **Connect to caller** in the creator window and **Allow microphone &
   connect** in the caller window.
5. Confirm both screens show **Direct audio connected**, the countdown moves,
   mute disables the local microphone, and either **End call** button releases
   the active slot.

Use headphones when both browsers are on one computer to avoid acoustic
feedback. `localhost` is treated as a secure media context by current browsers;
non-local environments require HTTPS/WSS.

## Lifecycle and recovery

- No media API is touched while a viewer is merely waiting.
- Microphone denial leaves the call retryable and shows browser-setting help.
- The caller announces readiness only after local media succeeds. The creator is
  the sole offerer, avoiding negotiation glare.
- SDP and trickle ICE use the private call channel. A signaling reconnect uses
  exponential backoff; established P2P audio can continue without WebSocket.
- `connected` moves the durable call to `LIVE`. Peer failure moves it to
  `FAILED`, releasing the show's active-call slot.
- PostgreSQL stores `started_at` and the snapshotted duration. A backend sweep
  ends expired calls even if both browser timers disappear.
- End, failure, unmount, and retry paths close `RTCPeerConnection`, close the
  signaling socket, clear timers, detach remote media, and stop every local
  track.
- A `pagehide` beacon attempts immediate call termination when either participant
  closes the page. Server-side disconnect grace and presence enforcement remain
  part of the reliability follow-up.
