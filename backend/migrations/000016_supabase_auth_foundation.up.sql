-- Prepare the current application-owned identities and opaque sessions for a
-- staged Supabase Auth cutover. Existing bcrypt authentication remains valid
-- until the HTTP handlers are switched in a later migration/deploy.
ALTER TABLE users
    ALTER COLUMN password_hash DROP NOT NULL,
    ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local',
    ADD COLUMN provider_user_id UUID,
    ADD CONSTRAINT users_auth_provider_valid
        CHECK (auth_provider IN ('local', 'supabase')),
    ADD CONSTRAINT users_provider_identity_valid
        CHECK (
            (auth_provider = 'local' AND provider_user_id IS NULL)
            OR
            (auth_provider = 'supabase' AND provider_user_id = id)
        ),
    ADD CONSTRAINT users_provider_user_id_unique UNIQUE (provider_user_id);

-- Supabase projects provide auth.users. Local PostgreSQL test databases do not,
-- so add the cross-schema relationship only when that managed table exists.
DO $$
BEGIN
    IF to_regclass('auth.users') IS NOT NULL THEN
        ALTER TABLE users
            ADD CONSTRAINT users_supabase_identity_fk
            FOREIGN KEY (provider_user_id)
            REFERENCES auth.users(id)
            ON DELETE CASCADE;
    END IF;
END
$$;

ALTER TABLE sessions
    ADD COLUMN encrypted_refresh_token TEXT,
    ADD COLUMN provider_access_expires_at TIMESTAMPTZ,
    ADD COLUMN provider_validated_at TIMESTAMPTZ,
    ADD COLUMN revoked_at TIMESTAMPTZ,
    ADD CONSTRAINT sessions_provider_state_valid
        CHECK (
            (encrypted_refresh_token IS NULL AND provider_access_expires_at IS NULL)
            OR
            (encrypted_refresh_token IS NOT NULL AND provider_access_expires_at IS NOT NULL)
        );

CREATE INDEX sessions_active_expiry_idx
    ON sessions (expires_at)
    WHERE revoked_at IS NULL;

CREATE INDEX sessions_provider_user_idx
    ON sessions (user_id, provider_validated_at)
    WHERE encrypted_refresh_token IS NOT NULL AND revoked_at IS NULL;
