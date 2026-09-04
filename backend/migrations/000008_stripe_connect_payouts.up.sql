CREATE TABLE creator_payout_accounts (
    creator_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_account_id TEXT NOT NULL UNIQUE,
    charges_enabled BOOLEAN NOT NULL DEFAULT false,
    payouts_enabled BOOLEAN NOT NULL DEFAULT false,
    details_submitted BOOLEAN NOT NULL DEFAULT false,
    requirements_due TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payment_attempts
    ADD COLUMN destination_account_id TEXT,
    ADD COLUMN platform_fee_bps INTEGER,
    ADD COLUMN platform_fee_cents INTEGER,
    ADD CONSTRAINT payment_attempts_platform_fee_bps_valid
        CHECK (platform_fee_bps IS NULL OR platform_fee_bps BETWEEN 0 AND 10000),
    ADD CONSTRAINT payment_attempts_platform_fee_cents_valid
        CHECK (platform_fee_cents IS NULL OR platform_fee_cents BETWEEN 0 AND amount_cents),
    ADD CONSTRAINT payment_attempts_connect_snapshot_complete
        CHECK (
            (destination_account_id IS NULL AND platform_fee_bps IS NULL AND platform_fee_cents IS NULL)
            OR
            (destination_account_id IS NOT NULL AND platform_fee_bps IS NOT NULL AND platform_fee_cents IS NOT NULL)
        );
