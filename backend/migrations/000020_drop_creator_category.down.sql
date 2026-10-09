ALTER TABLE creator_profiles
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Just chatting'
    CHECK (category IN ('Just chatting','Music','Gaming','Creative','Tech'));
CREATE INDEX IF NOT EXISTS creator_directory_category_rank ON creator_profiles(category, is_live DESC, follower_count DESC, user_id DESC) WHERE published;
