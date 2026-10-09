-- Display metadata is optional. Historical diagnostics and provider content stay intact.
ALTER TABLE messages ADD COLUMN localized_content_json TEXT;
ALTER TABLE restore_operations ADD COLUMN localized_conflicts_json TEXT;
ALTER TABLE restore_operations ADD COLUMN localized_unsupported_json TEXT;
