-- Optional host output segments; retain command text and legacy task results.
ALTER TABLE project_action_runs ADD COLUMN localized_output_json TEXT;
