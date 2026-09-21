-- Intentionally irreversible. Restoring direct Data API access would expand
-- the application's trust boundary and must be done in a new audited migration
-- with explicit RLS policies and tests.
SELECT 1;
