-- Executed on the dedicated migration connection with foreign_keys disabled.
-- The guard fails inside the migration transaction if this prerequisite is lost.
CREATE TEMP TABLE plugin_migration_guard (valid INTEGER NOT NULL CHECK (valid = 1));
INSERT INTO plugin_migration_guard SELECT foreign_keys = 0 FROM pragma_foreign_keys;

CREATE TABLE sessions_plugin_migration (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  label TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('created','starting','idle','running','waiting_approval','waiting_user','compacting','interrupted','failed','closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  plugin_installation_id TEXT REFERENCES plugin_installations(id)
);
INSERT INTO sessions_plugin_migration (id,workspace_id,agent,label,state,created_at,updated_at,archived)
  SELECT id,workspace_id,agent,label,state,created_at,updated_at,archived FROM sessions;
INSERT INTO plugin_migration_guard SELECT
  (SELECT COUNT(*) FROM sessions_plugin_migration) = (SELECT COUNT(*) FROM sessions);
DROP TABLE sessions;
ALTER TABLE sessions_plugin_migration RENAME TO sessions;
CREATE INDEX idx_sessions_workspace_updated ON sessions(workspace_id,updated_at DESC);

CREATE TABLE process_runs_plugin_migration (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  agent TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  pid INTEGER,
  state TEXT NOT NULL CHECK (state IN ('starting','running','stopping','exited','crashed')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  plugin_installation_id TEXT REFERENCES plugin_installations(id),
  runtime_protocol_version TEXT
);
INSERT INTO process_runs_plugin_migration (id,session_id,agent,generation_id,pid,state,started_at,ended_at)
  SELECT id,session_id,agent,generation_id,pid,state,started_at,ended_at FROM process_runs;
INSERT INTO plugin_migration_guard SELECT
  (SELECT COUNT(*) FROM process_runs_plugin_migration) = (SELECT COUNT(*) FROM process_runs);
DROP TABLE process_runs;
ALTER TABLE process_runs_plugin_migration RENAME TO process_runs;
ALTER TABLE session_bindings ADD COLUMN plugin_binding_json TEXT;
ALTER TABLE agent_events ADD COLUMN schema_version TEXT NOT NULL DEFAULT '1.0';
CREATE TABLE plugin_views (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  view_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  document_json TEXT NOT NULL,
  PRIMARY KEY(session_id,view_id)
);
INSERT INTO plugin_migration_guard SELECT COUNT(*) = 0 FROM pragma_foreign_key_check;
DROP TABLE plugin_migration_guard;
