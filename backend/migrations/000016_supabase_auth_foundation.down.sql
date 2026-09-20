DROP INDEX IF EXISTS sessions_provider_user_idx;
DROP INDEX IF EXISTS sessions_active_expiry_idx;

ALTER TABLE sessions
    DROP CONSTRAINT IF EXISTS sessions_provider_state_valid,
    DROP COLUMN IF EXISTS revoked_at,
    DROP COLUMN IF EXISTS provider_validated_at,
    DROP COLUMN IF EXISTS provider_access_expires_at,
    DROP COLUMN IF EXISTS encrypted_refresh_token;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_supabase_identity_fk,
    DROP CONSTRAINT IF EXISTS users_provider_user_id_unique,
    DROP CONSTRAINT IF EXISTS users_provider_identity_valid,
    DROP CONSTRAINT IF EXISTS users_auth_provider_valid,
    DROP COLUMN IF EXISTS provider_user_id,
    DROP COLUMN IF EXISTS auth_provider;

-- This intentionally fails rather than discarding users if a downgrade is
-- attempted after Supabase-backed rows with no password hash have been added.
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
