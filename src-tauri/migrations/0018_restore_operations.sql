-- Durable audit record for every turn-change-set restore attempt. The system
-- timeline message remains a human-readable projection; these JSON arrays are
-- the machine-readable provenance consumed by later Handoff snapshots.
CREATE TABLE IF NOT EXISTS restore_operations (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'blocked', 'failed')),
  restored_json TEXT NOT NULL,
  conflicts_json TEXT NOT NULL,
  unsupported_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  FOREIGN KEY (turn_id) REFERENCES turns (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_restore_operations_turn_created
  ON restore_operations (session_id, turn_id, created_at DESC);
