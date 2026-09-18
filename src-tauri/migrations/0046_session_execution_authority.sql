-- Native enforcement is a host installation grant, never an Agent ID claim.
CREATE TABLE session_execution_authorities (
  installation_id TEXT NOT NULL REFERENCES plugin_installations(id) ON DELETE CASCADE,
  contribution_id TEXT NOT NULL,
  backend TEXT NOT NULL CHECK (backend IN ('codex-native', 'core-proxy')),
  PRIMARY KEY (installation_id, contribution_id)
);
