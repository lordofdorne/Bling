ALTER TABLE payment_attempts
    ADD COLUMN payment_flow TEXT NOT NULL DEFAULT 'DESTINATION',
    ADD CONSTRAINT payment_attempts_payment_flow_valid
        CHECK (payment_flow IN ('DESTINATION', 'PLATFORM'));

-- Attempts created before Connect had no destination and are platform charges.
-- Keep DESTINATION as the column default until every old API replica is gone:
-- the new API always inserts PLATFORM explicitly.
UPDATE payment_attempts
SET payment_flow = CASE WHEN destination_account_id IS NULL THEN 'PLATFORM' ELSE 'DESTINATION' END;

ALTER TABLE payment_attempts DROP CONSTRAINT payment_attempts_connect_snapshot_complete;
ALTER TABLE payment_attempts
    ADD CONSTRAINT payment_attempts_connect_snapshot_complete CHECK (
        (platform_fee_bps IS NULL AND platform_fee_cents IS NULL AND destination_account_id IS NULL)
        OR
        (platform_fee_bps IS NOT NULL AND platform_fee_cents IS NOT NULL AND (
            (payment_flow = 'DESTINATION' AND destination_account_id IS NOT NULL)
            OR (payment_flow = 'PLATFORM' AND destination_account_id IS NULL)
        ))
    );

CREATE TABLE creator_payout_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'CREATED',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT creator_payout_runs_period_valid CHECK (period_end > period_start),
    CONSTRAINT creator_payout_runs_currency_valid CHECK (currency ~ '^[a-z]{3}$'),
    CONSTRAINT creator_payout_runs_status_valid CHECK (status IN ('CREATED','PROCESSING','COMPLETED','PARTIAL_FAILED')),
    UNIQUE (period_start, period_end, currency)
);

CREATE TABLE creator_payout_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES creator_payout_runs(id) ON DELETE RESTRICT,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount_cents BIGINT NOT NULL,
    currency TEXT NOT NULL,
    destination_account_id TEXT NOT NULL,
    stripe_transfer_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'RESERVED',
    idempotency_key TEXT NOT NULL UNIQUE,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    failure_code TEXT,
    failure_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT creator_payout_items_amount_positive CHECK (amount_cents > 0),
    CONSTRAINT creator_payout_items_currency_valid CHECK (currency ~ '^[a-z]{3}$'),
    CONSTRAINT creator_payout_items_status_valid CHECK (status IN ('RESERVED','SENDING','PAID','RETRY','FAILED','CANCELED')),
    CONSTRAINT creator_payout_items_attempts_valid CHECK (attempts >= 0),
    UNIQUE (run_id, creator_id, currency)
);

CREATE INDEX creator_payout_items_work_idx
    ON creator_payout_items(next_attempt_at, id) WHERE status IN ('RESERVED','RETRY');
CREATE UNIQUE INDEX creator_payout_items_one_unsettled_idx
    ON creator_payout_items(creator_id,currency) WHERE status IN ('RESERVED','SENDING','RETRY','FAILED');

CREATE TABLE creator_ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL,
    amount_cents BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    payment_attempt_id UUID REFERENCES payment_attempts(id) ON DELETE RESTRICT,
    call_id UUID REFERENCES calls(id) ON DELETE RESTRICT,
    payout_item_id UUID REFERENCES creator_payout_items(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL UNIQUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT creator_ledger_entries_amount_nonzero CHECK (amount_cents <> 0),
    CONSTRAINT creator_ledger_entries_currency_valid CHECK (currency ~ '^[a-z]{3}$'),
    CONSTRAINT creator_ledger_entries_kind_valid CHECK (kind IN (
        'EARNING','REFUND_REVERSAL','DISPUTE_DEBIT','DISPUTE_RELEASE',
        'PAYOUT_RESERVATION','PAYOUT_RELEASE','ADJUSTMENT'
    ))
);

CREATE INDEX creator_ledger_entries_balance_idx
    ON creator_ledger_entries(creator_id, currency, effective_at, id);
CREATE INDEX creator_ledger_entries_payment_idx
    ON creator_ledger_entries(payment_attempt_id) WHERE payment_attempt_id IS NOT NULL;
CREATE INDEX creator_ledger_entries_payout_idx
    ON creator_ledger_entries(payout_item_id) WHERE payout_item_id IS NOT NULL;
CREATE UNIQUE INDEX creator_ledger_entries_one_earning_idx
    ON creator_ledger_entries(payment_attempt_id) WHERE kind = 'EARNING';

CREATE OR REPLACE FUNCTION creator_ledger_refund_reversal() RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'SUCCEEDED' AND OLD.status IS DISTINCT FROM 'SUCCEEDED' THEN
        INSERT INTO creator_ledger_entries(
            creator_id,kind,amount_cents,currency,effective_at,payment_attempt_id,call_id,idempotency_key,metadata
        )
        SELECT e.creator_id,'REFUND_REVERSAL',-e.amount_cents,e.currency,NEW.updated_at,
               NEW.payment_attempt_id,NEW.call_id,'refund:' || NEW.id::text,
               jsonb_build_object('refundId', COALESCE(NEW.stripe_refund_id, ''))
        FROM creator_ledger_entries e
        WHERE e.payment_attempt_id=NEW.payment_attempt_id AND e.kind='EARNING'
        ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_refunds_ledger_reversal
AFTER UPDATE OF status ON payment_refunds
FOR EACH ROW EXECUTE FUNCTION creator_ledger_refund_reversal();

CREATE OR REPLACE FUNCTION creator_ledger_dispute_adjustment() RETURNS trigger AS $$
DECLARE
    earning creator_ledger_entries%ROWTYPE;
    debited BIGINT;
BEGIN
    IF NEW.payment_attempt_id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO earning FROM creator_ledger_entries
      WHERE payment_attempt_id=NEW.payment_attempt_id AND kind='EARNING' LIMIT 1;
    IF NOT FOUND THEN RETURN NEW; END IF;

    IF NEW.status IN ('needs_response','under_review','lost','warning_needs_response','warning_under_review') THEN
        INSERT INTO creator_ledger_entries(
            creator_id,kind,amount_cents,currency,effective_at,payment_attempt_id,idempotency_key,metadata
        ) VALUES (
            earning.creator_id,'DISPUTE_DEBIT',-earning.amount_cents,earning.currency,NEW.updated_at,
            NEW.payment_attempt_id,'dispute-debit:' || NEW.stripe_dispute_id,
            jsonb_build_object('disputeId',NEW.stripe_dispute_id,'status',NEW.status)
        ) ON CONFLICT(idempotency_key) DO NOTHING;
    ELSIF NEW.status IN ('won','warning_closed','prevented') THEN
        SELECT -amount_cents INTO debited FROM creator_ledger_entries
          WHERE idempotency_key='dispute-debit:' || NEW.stripe_dispute_id;
        IF FOUND THEN
            INSERT INTO creator_ledger_entries(
                creator_id,kind,amount_cents,currency,effective_at,payment_attempt_id,idempotency_key,metadata
            ) VALUES (
                earning.creator_id,'DISPUTE_RELEASE',debited,earning.currency,NEW.updated_at,
                NEW.payment_attempt_id,'dispute-release:' || NEW.stripe_dispute_id,
                jsonb_build_object('disputeId',NEW.stripe_dispute_id,'status',NEW.status)
            ) ON CONFLICT(idempotency_key) DO NOTHING;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_disputes_ledger_adjustment
AFTER INSERT OR UPDATE OF status ON payment_disputes
FOR EACH ROW EXECUTE FUNCTION creator_ledger_dispute_adjustment();
