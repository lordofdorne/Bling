-- Creators are never asked for a category, so the column only ever held the
-- default. Discovery ranks on live status and followers alone. Idempotent so
-- it can be applied ahead of 016–019 on a local database.
DROP INDEX IF EXISTS creator_directory_category_rank;
ALTER TABLE creator_profiles DROP COLUMN IF EXISTS category;
