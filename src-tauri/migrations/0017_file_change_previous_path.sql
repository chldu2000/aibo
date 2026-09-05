-- Preserve the source path when a turn moves a file. The destination remains
-- the canonical `path`; previous_path is optional for older change sets.
ALTER TABLE file_changes ADD COLUMN previous_path TEXT;
