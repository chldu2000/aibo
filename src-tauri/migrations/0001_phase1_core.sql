-- Phase 1 owns workspace and process metadata. Session/timeline tables are
-- intentionally present as narrow projections for the later adapters.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  path TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  trusted INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0, 1)),
  last_opened_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspaces_last_opened
  ON workspaces (last_opened_at DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_installations (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT,
  agent TEXT NOT NULL CHECK (agent IN ('codex', 'pi')),
  executable TEXT,
  version TEXT,
  auth_state TEXT NOT NULL DEFAULT 'delegated',
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  probed_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_installations_scope
  ON agent_installations (workspace_id, agent);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  agent TEXT NOT NULL CHECK (agent IN ('codex', 'pi')),
  label TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('created', 'starting', 'idle', 'running', 'waiting_approval', 'interrupted', 'failed', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_workspace_updated
  ON sessions (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS session_bindings (
  session_id TEXT PRIMARY KEY NOT NULL,
  external_session_id TEXT,
  generation_id TEXT,
  adapter_version TEXT,
  bound_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS process_runs (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT,
  agent TEXT NOT NULL CHECK (agent IN ('codex', 'pi')),
  generation_id TEXT NOT NULL,
  pid INTEGER,
  state TEXT NOT NULL CHECK (state IN ('starting', 'running', 'stopping', 'exited', 'crashed')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE SET NULL
);
