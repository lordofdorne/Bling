-- Creators are never asked for a category, so the column only ever held the
-- default. Discovery ranks on live status and followers alone.
DROP INDEX IF EXISTS creator_directory_category_rank;
ALTER TABLE creator_profiles DROP COLUMN category;
