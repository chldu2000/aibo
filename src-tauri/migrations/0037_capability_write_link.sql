-- Existing read invocations retain NULL; do not infer historical write authority.
ALTER TABLE capability_invocations ADD COLUMN write_run_id TEXT REFERENCES workspace_write_runs(id);
CREATE INDEX capability_invocations_write_run ON capability_invocations(write_run_id);
