ALTER TABLE calls
  ADD COLUMN creator_disconnected_at timestamptz,
  ADD COLUMN viewer_disconnected_at timestamptz;

CREATE INDEX calls_creator_disconnect_deadline_idx ON calls (creator_disconnected_at)
  WHERE status IN ('CREATED', 'CONNECTING', 'LIVE') AND creator_disconnected_at IS NOT NULL;

CREATE INDEX calls_viewer_disconnect_deadline_idx ON calls (viewer_disconnected_at)
  WHERE status IN ('CREATED', 'CONNECTING', 'LIVE') AND viewer_disconnected_at IS NOT NULL;
