ALTER TABLE calls ADD COLUMN expires_at TIMESTAMPTZ;

UPDATE calls
SET started_at = COALESCE(started_at, updated_at),
    expires_at = COALESCE(started_at, updated_at) + call_duration_seconds * interval '1 second'
WHERE status = 'LIVE';

ALTER TABLE calls
    ADD CONSTRAINT calls_live_has_expiry CHECK (
        status <> 'LIVE' OR expires_at IS NOT NULL
    );

CREATE INDEX calls_live_timeout_idx
    ON calls (expires_at)
    WHERE status = 'LIVE';
