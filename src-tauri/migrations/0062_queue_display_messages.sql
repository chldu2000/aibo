-- Optional host display metadata; retain original queue errors and delivery state.
ALTER TABLE queued_messages ADD COLUMN localized_error_json TEXT;
