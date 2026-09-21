CREATE TABLE auth_recovery_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    encrypted_access_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT auth_recovery_grants_expiry_valid CHECK (expires_at > created_at)
);

CREATE INDEX auth_recovery_grants_active_expiry_idx
    ON auth_recovery_grants (expires_at)
    WHERE used_at IS NULL;
