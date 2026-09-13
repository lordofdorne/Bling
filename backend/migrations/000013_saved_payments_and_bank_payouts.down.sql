ALTER TABLE creator_payout_accounts
    DROP CONSTRAINT IF EXISTS creator_payout_accounts_currency_safe,
    DROP CONSTRAINT IF EXISTS creator_payout_accounts_last4_safe,
    DROP COLUMN IF EXISTS external_account_currency,
    DROP COLUMN IF EXISTS external_account_last4,
    DROP COLUMN IF EXISTS external_account_bank_name,
    DROP COLUMN IF EXISTS external_account_present,
    DROP COLUMN IF EXISTS bank_payouts_status;

DROP INDEX IF EXISTS payment_attempts_payer_idx;

ALTER TABLE payment_attempts
    DROP CONSTRAINT IF EXISTS payment_attempts_customer_owner_complete,
    DROP COLUMN IF EXISTS save_consent_observed_at,
    DROP COLUMN IF EXISTS saved_payment_method_id,
    DROP COLUMN IF EXISTS stripe_customer_id,
    DROP COLUMN IF EXISTS payer_user_id;

DROP TABLE IF EXISTS user_payment_profiles;

