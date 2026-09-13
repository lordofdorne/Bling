CREATE TABLE user_payment_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payment_attempts
    ADD COLUMN payer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN stripe_customer_id TEXT,
    ADD COLUMN saved_payment_method_id TEXT,
    ADD COLUMN save_consent_observed_at TIMESTAMPTZ,
    ADD CONSTRAINT payment_attempts_customer_owner_complete CHECK (
        (payer_user_id IS NULL AND stripe_customer_id IS NULL)
        OR (payer_user_id IS NOT NULL AND stripe_customer_id IS NOT NULL)
    );

CREATE INDEX payment_attempts_payer_idx
    ON payment_attempts (payer_user_id, created_at DESC)
    WHERE payer_user_id IS NOT NULL;

ALTER TABLE creator_payout_accounts
    ADD COLUMN bank_payouts_status TEXT NOT NULL DEFAULT '',
    ADD COLUMN external_account_present BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN external_account_bank_name TEXT,
    ADD COLUMN external_account_last4 TEXT,
    ADD COLUMN external_account_currency TEXT,
    ADD CONSTRAINT creator_payout_accounts_last4_safe CHECK (
        external_account_last4 IS NULL OR external_account_last4 ~ '^[0-9]{4}$'
    ),
    ADD CONSTRAINT creator_payout_accounts_currency_safe CHECK (
        external_account_currency IS NULL OR external_account_currency ~ '^[a-z]{3}$'
    );

