-- Phase 4.5 keeps the requested profile separate from the adapter-enforced
-- profile so unsupported capabilities cannot be silently presented as active.
CREATE TABLE IF NOT EXISTS session_execution_profiles (
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
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_execution_profiles_updated
  ON session_execution_profiles (updated_at DESC);
