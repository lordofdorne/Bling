ALTER TABLE payment_attempts
    DROP CONSTRAINT payment_attempts_connect_snapshot_complete,
    DROP CONSTRAINT payment_attempts_platform_fee_cents_valid,
    DROP CONSTRAINT payment_attempts_platform_fee_bps_valid,
    DROP COLUMN platform_fee_cents,
    DROP COLUMN platform_fee_bps,
    DROP COLUMN destination_account_id;

DROP TABLE creator_payout_accounts;
