CREATE TABLE stripe_webhook_events (
    stripe_event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    connected_account_id TEXT,
    status TEXT NOT NULL DEFAULT 'PROCESSING',
    attempts INTEGER NOT NULL DEFAULT 1,
    failure_code TEXT,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stripe_webhook_events_status_valid CHECK (status IN ('PROCESSING','PROCESSED','FAILED')),
    CONSTRAINT stripe_webhook_events_attempts_positive CHECK (attempts > 0)
);

CREATE INDEX stripe_webhook_events_retry_idx
    ON stripe_webhook_events (locked_at) WHERE status IN ('PROCESSING','FAILED');

CREATE TABLE payment_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_attempt_id UUID NOT NULL UNIQUE REFERENCES payment_attempts(id) ON DELETE CASCADE,
    call_id UUID NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
    stripe_payment_intent_id TEXT NOT NULL,
    stripe_refund_id TEXT UNIQUE,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'REQUESTED',
    attempts INTEGER NOT NULL DEFAULT 0,
    failure_code TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_refunds_amount_positive CHECK (amount_cents > 0),
    CONSTRAINT payment_refunds_currency_format CHECK (currency ~ '^[a-z]{3}$'),
    CONSTRAINT payment_refunds_status_valid CHECK (status IN ('REQUESTED','PROCESSING','RETRY','PENDING','SUCCEEDED','FAILED')),
    CONSTRAINT payment_refunds_attempts_nonnegative CHECK (attempts >= 0)
);

CREATE INDEX payment_refunds_work_idx
    ON payment_refunds (next_attempt_at) WHERE status IN ('REQUESTED','RETRY','PENDING');

CREATE TABLE payment_disputes (
    stripe_dispute_id TEXT PRIMARY KEY,
    payment_attempt_id UUID REFERENCES payment_attempts(id) ON DELETE SET NULL,
    stripe_payment_intent_id TEXT,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    evidence_due_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_disputes_amount_positive CHECK (amount_cents > 0),
    CONSTRAINT payment_disputes_currency_format CHECK (currency ~ '^[a-z]{3}$')
);

CREATE INDEX payment_disputes_attempt_idx ON payment_disputes (payment_attempt_id, updated_at DESC);

CREATE TABLE creator_payout_events (
    stripe_payout_id TEXT PRIMARY KEY,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    failure_code TEXT,
    failure_message TEXT,
    arrival_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT creator_payout_events_amount_positive CHECK (amount_cents > 0),
    CONSTRAINT creator_payout_events_currency_format CHECK (currency ~ '^[a-z]{3}$')
);

CREATE INDEX creator_payout_events_creator_idx ON creator_payout_events (creator_id, updated_at DESC);
