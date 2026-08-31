ALTER TABLE show_tiers
  ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT show_tiers_price_range CHECK (price_cents BETWEEN 0 AND 1000000);

CREATE UNIQUE INDEX show_tiers_show_name_case_insensitive_idx
  ON show_tiers (show_id, lower(name));

ALTER TABLE queue_entries
  ADD COLUMN tier_price_cents INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT queue_entries_tier_price_range CHECK (tier_price_cents BETWEEN 0 AND 1000000);
