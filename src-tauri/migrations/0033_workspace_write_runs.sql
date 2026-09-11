CREATE TABLE workspace_write_runs (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','outcome_unknown')),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  started_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_workspace_write_runs_history ON workspace_write_runs(workspace_id, started_at DESC, id DESC);
