-- Optional display metadata; retain historical capture errors and attribution.
ALTER TABLE turn_change_sets ADD COLUMN localized_capture_error_json TEXT;
