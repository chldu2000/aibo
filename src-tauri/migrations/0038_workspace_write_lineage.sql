-- Parent/root lineage is host-owned. Historical records remain NULL.
ALTER TABLE workspace_write_runs ADD COLUMN parent_write_run_id TEXT REFERENCES workspace_write_runs(id);
ALTER TABLE workspace_write_runs ADD COLUMN root_write_run_id TEXT REFERENCES workspace_write_runs(id);
CREATE INDEX workspace_write_runs_root ON workspace_write_runs(root_write_run_id);
