ALTER TABLE calls DROP CONSTRAINT calls_payment_attempt_fk;
ALTER TABLE calls DROP COLUMN payment_attempt_id;
DROP INDEX calls_one_active_per_show_idx;
CREATE UNIQUE INDEX calls_one_active_per_show_idx
    ON calls (show_id)
    WHERE status IN ('CREATED', 'CONNECTING', 'LIVE');
ALTER TABLE calls DROP CONSTRAINT calls_status_valid;
ALTER TABLE calls
    ADD CONSTRAINT calls_status_valid CHECK (status IN ('CREATED', 'CONNECTING', 'LIVE', 'ENDED', 'FAILED'));

ALTER TABLE queue_entries DROP CONSTRAINT queue_entries_payment_attempt_fk;
ALTER TABLE queue_entries DROP COLUMN payment_attempt_id;
DROP TABLE payment_attempts;
ALTER TABLE show_tiers DROP CONSTRAINT IF EXISTS show_tiers_stripe_minimum;
