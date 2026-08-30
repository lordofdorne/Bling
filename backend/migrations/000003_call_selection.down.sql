ALTER TABLE queue_outbox DROP CONSTRAINT queue_outbox_event_type_valid;
DELETE FROM queue_outbox WHERE event_type NOT IN (
    'queue.caller_joined', 'queue.caller_left', 'queue.show_ended'
);
ALTER TABLE queue_outbox
    ADD CONSTRAINT queue_outbox_event_type_valid CHECK (event_type IN (
        'queue.caller_joined', 'queue.caller_left', 'queue.show_ended'
    ));

ALTER TABLE calls
    DROP CONSTRAINT calls_duration_range,
    DROP CONSTRAINT calls_selection_mode_valid,
    DROP COLUMN call_duration_seconds,
    DROP COLUMN selection_mode;
