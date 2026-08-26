DROP TABLE IF EXISTS queue_outbox;
DROP INDEX IF EXISTS queue_entries_show_status_priority_position_idx;

ALTER TABLE queue_entries
    DROP CONSTRAINT IF EXISTS queue_entries_join_key_unique,
    DROP CONSTRAINT IF EXISTS queue_entries_duration_range,
    DROP CONSTRAINT IF EXISTS queue_entries_priority_range,
    DROP CONSTRAINT IF EXISTS queue_entries_tier_name_length,
    DROP CONSTRAINT IF EXISTS queue_entries_tier_fk,
    DROP COLUMN IF EXISTS join_key_hash,
    DROP COLUMN IF EXISTS call_duration_seconds,
    DROP COLUMN IF EXISTS priority_rank,
    DROP COLUMN IF EXISTS tier_name,
    DROP COLUMN IF EXISTS tier_id,
    ALTER COLUMN queue_position DROP DEFAULT;

DROP TABLE IF EXISTS show_tiers;
DROP SEQUENCE IF EXISTS queue_entry_position_seq;
