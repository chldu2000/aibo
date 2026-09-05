-- Keep per-file baseline attribution so unrelated user edits do not block
-- restoring an Agent change in the same turn.
ALTER TABLE file_changes ADD COLUMN baseline_dirty INTEGER NOT NULL DEFAULT 0;
