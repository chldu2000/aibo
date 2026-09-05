-- Phase 4.5C stores turn-scoped workspace facts. The snapshot metadata is
-- authoritative for review/checkpoint orchestration; large file contents stay
-- outside SQLite and are represented by hashes in this first slice.
CREATE TABLE IF NOT EXISTS turn_change_sets (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  baseline_head TEXT,
  baseline_dirty INTEGER,
  baseline_captured_at TEXT,
  result_head TEXT,
  result_dirty INTEGER,
  result_captured_at TEXT,
  attribution TEXT NOT NULL CHECK (attribution IN ('agent', 'mixed', 'unknown')),
  capture_status TEXT NOT NULL CHECK (capture_status IN ('captured', 'partial', 'failed')),
  capture_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  FOREIGN KEY (turn_id) REFERENCES turns (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_change_sets_turn
  ON turn_change_sets (session_id, turn_id);

CREATE INDEX IF NOT EXISTS idx_turn_change_sets_workspace_updated
  ON turn_change_sets (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS file_changes (
  id TEXT PRIMARY KEY NOT NULL,
  change_set_id TEXT NOT NULL,
  path TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('added', 'modified', 'deleted', 'renamed')),
  baseline_exists INTEGER NOT NULL CHECK (baseline_exists IN (0, 1)),
  baseline_hash TEXT,
  baseline_size INTEGER,
  result_exists INTEGER NOT NULL CHECK (result_exists IN (0, 1)),
  result_hash TEXT,
  result_size INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (change_set_id) REFERENCES turn_change_sets (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_changes_set_path
  ON file_changes (change_set_id, path);
