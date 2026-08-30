DROP INDEX IF EXISTS calls_live_timeout_idx;
ALTER TABLE calls DROP COLUMN expires_at;
