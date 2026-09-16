CREATE TABLE creator_profile_avatars (
    user_id UUID PRIMARY KEY REFERENCES creator_profiles(user_id) ON DELETE CASCADE,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
    image_data BYTEA NOT NULL CHECK (octet_length(image_data) <= 786432),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
