-- Native provider permissions are distinct from host-enforced execution.
CREATE TABLE session_execution_profiles_new (
  session_id TEXT PRIMARY KEY NOT NULL,
  schema_version TEXT NOT NULL,
  requested_json TEXT NOT NULL,
  enforced_json TEXT NOT NULL,
  unsupported_json TEXT NOT NULL DEFAULT '[]',
  adapter_capabilities_json TEXT NOT NULL DEFAULT '[]',
  native_sandbox INTEGER NOT NULL DEFAULT 0 CHECK (native_sandbox IN (0, 1)),
  resolved_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  enforcement_backend TEXT NOT NULL DEFAULT '"unnegotiated"' CHECK (enforcement_backend IN ('"codex-native"', '"core-proxy"', '"unnegotiated"', '"agent-managed"')),
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
);
INSERT INTO session_execution_profiles_new SELECT * FROM session_execution_profiles;
DROP TABLE session_execution_profiles;
ALTER TABLE session_execution_profiles_new RENAME TO session_execution_profiles;
CREATE INDEX idx_session_execution_profiles_updated ON session_execution_profiles (updated_at DESC);
