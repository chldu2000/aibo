-- Session-scoped context references. The next turn may consume these records;
-- the original path/hash remain auditable after the rendered prompt changes.
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  path TEXT NOT NULL,
  content_hash TEXT,
  size INTEGER,
  media_type TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('picker', 'drop', 'manual')),
  send_strategy TEXT NOT NULL CHECK (send_strategy IN ('reference', 'inline')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  FOREIGN KEY (turn_id) REFERENCES turns (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_session_created
  ON attachments (session_id, created_at ASC);
