ALTER TABLE calls
    ADD COLUMN selection_mode TEXT NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN call_duration_seconds INTEGER;

UPDATE calls c
SET call_duration_seconds = q.call_duration_seconds
FROM queue_entries q
WHERE q.id = c.queue_entry_id;

ALTER TABLE calls
    ALTER COLUMN call_duration_seconds SET DEFAULT 300,
    ALTER COLUMN call_duration_seconds SET NOT NULL,
    ADD CONSTRAINT calls_selection_mode_valid CHECK (selection_mode IN ('MANUAL', 'RANDOM')),
    ADD CONSTRAINT calls_duration_range CHECK (call_duration_seconds BETWEEN 30 AND 3600);

ALTER TABLE queue_outbox DROP CONSTRAINT queue_outbox_event_type_valid;
ALTER TABLE queue_outbox
    ADD CONSTRAINT queue_outbox_event_type_valid CHECK (event_type IN (
        'queue.caller_joined',
        'queue.caller_left',
        'queue.caller_selected',
        'queue.show_ended',
        'call.connecting',
        'call.live',
        'call.ended',
        'call.failed'
    ));
