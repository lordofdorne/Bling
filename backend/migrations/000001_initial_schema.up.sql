CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9_]{3,30}$')
);

CREATE UNIQUE INDEX users_username_unique ON users (lower(username));
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE shows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'CREATED',
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT shows_status_valid CHECK (status IN ('CREATED', 'LIVE', 'ENDED')),
    CONSTRAINT shows_live_has_started CHECK (status <> 'LIVE' OR started_at IS NOT NULL),
    CONSTRAINT shows_ended_has_ended_at CHECK (status <> 'ENDED' OR ended_at IS NOT NULL)
);

CREATE INDEX shows_creator_id_idx ON shows (creator_id);
CREATE INDEX shows_created_at_idx ON shows (created_at DESC);
CREATE UNIQUE INDEX shows_one_live_per_creator_idx ON shows (creator_id) WHERE status = 'LIVE';

CREATE TABLE queue_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    topic TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'WAITING',
    queue_position BIGINT NOT NULL,
    session_token_hash BYTEA NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    selected_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT queue_entries_status_valid CHECK (status IN ('WAITING', 'SELECTED', 'CONNECTING', 'LIVE', 'ENDED', 'LEFT', 'REJECTED')),
    CONSTRAINT queue_entries_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 60),
    CONSTRAINT queue_entries_topic_length CHECK (char_length(topic) BETWEEN 1 AND 280),
    CONSTRAINT queue_entries_position_positive CHECK (queue_position > 0),
    UNIQUE (show_id, id),
    UNIQUE (show_id, queue_position),
    UNIQUE (show_id, session_token_hash)
);

CREATE INDEX queue_entries_show_status_position_idx ON queue_entries (show_id, status, queue_position);
CREATE INDEX queue_entries_joined_at_idx ON queue_entries (joined_at);
CREATE UNIQUE INDEX queue_entries_one_selected_per_show_idx
    ON queue_entries (show_id)
    WHERE status IN ('SELECTED', 'CONNECTING', 'LIVE');

CREATE TABLE calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID NOT NULL,
    queue_entry_id UUID NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'CREATED',
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT calls_status_valid CHECK (status IN ('CREATED', 'CONNECTING', 'LIVE', 'ENDED', 'FAILED')),
    CONSTRAINT calls_ended_has_ended_at CHECK (status NOT IN ('ENDED', 'FAILED') OR ended_at IS NOT NULL),
    CONSTRAINT calls_queue_entry_show_fk
        FOREIGN KEY (show_id, queue_entry_id)
        REFERENCES queue_entries(show_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX calls_show_id_idx ON calls (show_id);
CREATE INDEX calls_created_at_idx ON calls (created_at DESC);
CREATE UNIQUE INDEX calls_one_active_per_show_idx
    ON calls (show_id)
    WHERE status IN ('CREATED', 'CONNECTING', 'LIVE');
