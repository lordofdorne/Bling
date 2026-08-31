ALTER TABLE show_tiers
    ADD CONSTRAINT show_tiers_stripe_minimum CHECK (price_cents = 0 OR price_cents >= 50);

CREATE TABLE payment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    tier_id UUID NOT NULL,
    queue_entry_id UUID UNIQUE,
    viewer_token_hash BYTEA NOT NULL,
    idempotency_key_hash BYTEA NOT NULL,
    stripe_payment_intent_id TEXT UNIQUE,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'CREATED',
    failure_code TEXT,
    authorized_at TIMESTAMPTZ,
    captured_at TIMESTAMPTZ,
    canceled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_attempts_tier_fk
        FOREIGN KEY (show_id, tier_id) REFERENCES show_tiers(show_id, id) ON DELETE RESTRICT,
    CONSTRAINT payment_attempts_queue_fk
        FOREIGN KEY (show_id, queue_entry_id) REFERENCES queue_entries(show_id, id) ON DELETE RESTRICT,
    CONSTRAINT payment_attempts_amount_positive CHECK (amount_cents > 0),
    CONSTRAINT payment_attempts_currency_format CHECK (currency ~ '^[a-z]{3}$'),
    CONSTRAINT payment_attempts_status_valid CHECK (status IN (
        'CREATED', 'AUTHORIZED', 'CAPTURING', 'CAPTURED', 'CANCELED', 'FAILED'
    )),
	UNIQUE (show_id, id),
    UNIQUE (show_id, idempotency_key_hash)
);

CREATE INDEX payment_attempts_show_status_idx ON payment_attempts (show_id, status);
CREATE INDEX payment_attempts_stale_idx ON payment_attempts (updated_at)
    WHERE status IN ('CREATED', 'AUTHORIZED', 'CAPTURING');

ALTER TABLE queue_entries
    ADD COLUMN payment_attempt_id UUID UNIQUE,
    ADD CONSTRAINT queue_entries_payment_attempt_fk
        FOREIGN KEY (show_id, payment_attempt_id) REFERENCES payment_attempts(show_id, id) ON DELETE RESTRICT;

ALTER TABLE calls DROP CONSTRAINT calls_status_valid;
ALTER TABLE calls
    ADD CONSTRAINT calls_status_valid CHECK (status IN (
        'PAYMENT_PENDING', 'CREATED', 'CONNECTING', 'LIVE', 'ENDED', 'FAILED'
    ));

DROP INDEX calls_one_active_per_show_idx;
CREATE UNIQUE INDEX calls_one_active_per_show_idx
    ON calls (show_id)
    WHERE status IN ('PAYMENT_PENDING', 'CREATED', 'CONNECTING', 'LIVE');

ALTER TABLE calls
    ADD COLUMN payment_attempt_id UUID,
    ADD CONSTRAINT calls_payment_attempt_fk
        FOREIGN KEY (payment_attempt_id) REFERENCES payment_attempts(id) ON DELETE RESTRICT;
