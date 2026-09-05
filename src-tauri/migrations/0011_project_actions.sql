CREATE TABLE IF NOT EXISTS project_actions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('test', 'lint', 'build', 'custom')),
  program TEXT NOT NULL,
  args_json TEXT NOT NULL,
  cwd TEXT NOT NULL DEFAULT '.',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_project_actions_workspace ON project_actions(workspace_id, enabled, name);
