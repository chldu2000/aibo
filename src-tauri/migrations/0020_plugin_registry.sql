-- P4.7B installation metadata. No historical session or event rows are rewritten.
CREATE TABLE plugin_installations (
  id TEXT PRIMARY KEY NOT NULL,
  plugin_id TEXT NOT NULL,
  plugin_version TEXT NOT NULL,
  package_digest TEXT NOT NULL,
  source TEXT NOT NULL,
  install_path TEXT NOT NULL UNIQUE,
  manifest_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  enabled_at TEXT,
  UNIQUE (plugin_id, plugin_version, package_digest)
);
CREATE TABLE agent_contributions (
  installation_id TEXT NOT NULL REFERENCES plugin_installations(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  PRIMARY KEY (installation_id, agent_id)
);
CREATE INDEX idx_agent_contributions_identity ON agent_contributions(agent_id);
