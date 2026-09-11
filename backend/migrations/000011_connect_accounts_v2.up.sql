-- Bling creates Stripe Accounts v2 recipient accounts. The only capability that
-- governs paid calls is stripe_balance.stripe_transfers, so record its status
-- verbatim instead of inferring it from the v1 boolean fields.
--
-- charges_enabled, payouts_enabled and details_submitted are deliberately kept:
-- the paid-call readiness predicate is inlined in payment, queue and show SQL,
-- and they are now derived from the transfers capability by the payout gateway.
ALTER TABLE creator_payout_accounts
    ADD COLUMN transfers_status TEXT NOT NULL DEFAULT '';
