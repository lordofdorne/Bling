DROP INDEX IF EXISTS calls_viewer_disconnect_deadline_idx;
DROP INDEX IF EXISTS calls_creator_disconnect_deadline_idx;
ALTER TABLE calls
  DROP COLUMN IF EXISTS viewer_disconnected_at,
  DROP COLUMN IF EXISTS creator_disconnected_at;
