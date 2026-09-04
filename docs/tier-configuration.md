# Hotline tier configuration

Creators configure a draft Hotline before it goes live. A configuration contains one to five ordered tiers. The first row has the highest selection priority; the API derives immutable priority ranks from that order and never accepts client-supplied ranks.

Each tier has:

- a unique name (case-insensitive within the show)
- a call duration from 30 to 3,600 seconds
- a future price from $0 to $10,000
- an enabled flag

At least one tier must remain enabled. Configuration updates lock the show row and are accepted only while the show is `CREATED`. Starting a show takes the same lock and checks that an enabled tier exists, so starting and editing cannot race.

Public callers see enabled tiers in priority order and explicitly choose one. Joining snapshots the tier name, priority, duration, and price onto the queue entry. Later edits cannot change an admitted caller's terms, and Stripe can use the snapshotted `tier_price_cents` rather than mutable configuration.

Paid tiers use the snapshotted creator price for Stripe authorization before queue admission and capture after host selection. A creator must finish Stripe payout onboarding before starting a Hotline with any enabled paid tier. The creator receives 70% and Bling takes a 30% platform fee. See [payments.md](payments.md).
