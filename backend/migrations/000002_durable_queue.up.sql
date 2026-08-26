CREATE SEQUENCE queue_entry_position_seq;

SELECT setval(
    'queue_entry_position_seq',
    COALESCE((SELECT max(queue_position) FROM queue_entries), 0) + 1,
    false
);

ALTER TABLE queue_entries
    ALTER COLUMN queue_position SET DEFAULT nextval('queue_entry_position_seq');

CREATE TABLE show_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    priority_rank INTEGER NOT NULL DEFAULT 0,
    call_duration_seconds INTEGER NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT show_tiers_name_length CHECK (char_length(name) BETWEEN 1 AND 40),
    CONSTRAINT show_tiers_priority_range CHECK (priority_rank BETWEEN 0 AND 1000),
    CONSTRAINT show_tiers_duration_range CHECK (call_duration_seconds BETWEEN 30 AND 3600),
    UNIQUE (show_id, id),
    UNIQUE (show_id, name)
);

CREATE INDEX show_tiers_show_enabled_priority_idx
    ON show_tiers (show_id, enabled, priority_rank DESC);

INSERT INTO show_tiers (show_id, name, priority_rank, call_duration_seconds)
SELECT id, 'Standard', 0, 300 FROM shows;

ALTER TABLE queue_entries
    ADD COLUMN tier_id UUID,
    ADD COLUMN tier_name TEXT NOT NULL DEFAULT 'Standard',
    ADD COLUMN priority_rank INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN call_duration_seconds INTEGER NOT NULL DEFAULT 300,
    ADD COLUMN join_key_hash BYTEA;

UPDATE queue_entries q
SET tier_id = t.id,
    join_key_hash = digest(q.id::text, 'sha256')
FROM show_tiers t
WHERE t.show_id = q.show_id AND t.name = 'Standard';

ALTER TABLE queue_entries
    ALTER COLUMN tier_id SET NOT NULL,
    ALTER COLUMN join_key_hash SET NOT NULL,
    ADD CONSTRAINT queue_entries_tier_fk
        FOREIGN KEY (show_id, tier_id) REFERENCES show_tiers(show_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT queue_entries_tier_name_length CHECK (char_length(tier_name) BETWEEN 1 AND 40),
    ADD CONSTRAINT queue_entries_priority_range CHECK (priority_rank BETWEEN 0 AND 1000),
    ADD CONSTRAINT queue_entries_duration_range CHECK (call_duration_seconds BETWEEN 30 AND 3600),
    ADD CONSTRAINT queue_entries_join_key_unique UNIQUE (show_id, join_key_hash);

CREATE INDEX queue_entries_show_status_priority_position_idx
    ON queue_entries (show_id, status, priority_rank DESC, queue_position);

CREATE TABLE queue_outbox (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT queue_outbox_event_type_valid CHECK (event_type IN ('queue.caller_joined', 'queue.caller_left', 'queue.show_ended'))
);

CREATE INDEX queue_outbox_unpublished_idx
    ON queue_outbox (id)
    WHERE published_at IS NULL;
