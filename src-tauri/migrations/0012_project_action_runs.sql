CREATE TABLE IF NOT EXISTS project_action_runs (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version TEXT NOT NULL,
  action_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'timed_out')),
  exit_code INTEGER,
  output TEXT NOT NULL,
  artifact_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (action_id) REFERENCES project_actions(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_project_action_runs_workspace ON project_action_runs(workspace_id, completed_at DESC);
