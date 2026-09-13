DROP TRIGGER IF EXISTS payment_disputes_ledger_adjustment ON payment_disputes;
DROP FUNCTION IF EXISTS creator_ledger_dispute_adjustment();
DROP TRIGGER IF EXISTS payment_refunds_ledger_reversal ON payment_refunds;
DROP FUNCTION IF EXISTS creator_ledger_refund_reversal();
DROP TABLE IF EXISTS creator_ledger_entries;
DROP TABLE IF EXISTS creator_payout_items;
DROP TABLE IF EXISTS creator_payout_runs;
ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_connect_snapshot_complete;
ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_payment_flow_valid;
ALTER TABLE payment_attempts DROP COLUMN IF EXISTS payment_flow;
ALTER TABLE payment_attempts
    ADD CONSTRAINT payment_attempts_connect_snapshot_complete CHECK (
        (destination_account_id IS NULL AND platform_fee_bps IS NULL AND platform_fee_cents IS NULL)
        OR
        (destination_account_id IS NOT NULL AND platform_fee_bps IS NOT NULL AND platform_fee_cents IS NOT NULL)
    );
