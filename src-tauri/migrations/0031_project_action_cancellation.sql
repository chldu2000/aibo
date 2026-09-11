-- Requesting cancellation is distinct from observing execution termination.
ALTER TABLE project_action_runs ADD COLUMN cancel_requested_at TEXT;
