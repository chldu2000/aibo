CREATE TABLE session_permission_grants (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  context_json TEXT NOT NULL,
  confirmed_at TEXT NOT NULL
);
ALTER TABLE workspaces ADD COLUMN permission_epoch INTEGER NOT NULL DEFAULT 0;
