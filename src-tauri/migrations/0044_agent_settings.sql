-- Schema versions are isolated so incompatible plugin upgrades cannot reinterpret values.
CREATE TABLE agent_settings (
  plugin_id TEXT NOT NULL,
  contribution_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('application','workspace','session')),
  scope_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  values_json TEXT NOT NULL,
  PRIMARY KEY(plugin_id, contribution_id, schema_version, scope_kind, scope_id)
);
