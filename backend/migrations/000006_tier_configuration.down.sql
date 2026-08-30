ALTER TABLE queue_entries
  DROP CONSTRAINT IF EXISTS queue_entries_tier_price_range,
  DROP COLUMN IF EXISTS tier_price_cents;

DROP INDEX IF EXISTS show_tiers_show_name_case_insensitive_idx;

ALTER TABLE show_tiers
  DROP CONSTRAINT IF EXISTS show_tiers_price_range,
  DROP COLUMN IF EXISTS price_cents;
