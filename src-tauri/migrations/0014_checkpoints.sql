-- Durable baseline checkpoint metadata. File bytes remain in app-data and are
-- addressed by the deterministic storage path; this table makes availability
-- and the captured baseline machine-readable after an application restart.
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  path TEXT NOT NULL,
  file_exists INTEGER NOT NULL CHECK (file_exists IN (0, 1)),
  content_hash TEXT,
  size INTEGER,
  storage_path TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  FOREIGN KEY (turn_id) REFERENCES turns (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkpoints_turn_path
  ON checkpoints (session_id, turn_id, path);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session_created
  ON checkpoints (session_id, created_at DESC);
