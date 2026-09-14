CREATE TABLE capability_provider_bindings (
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('application','workspace','session')),
    scope_id TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    installation_id TEXT NOT NULL REFERENCES plugin_installations(id),
    contribution_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(scope_kind,scope_id,capability_id,contract_version)
);
CREATE TABLE capability_invocations (
    id TEXT PRIMARY KEY NOT NULL,
    caller_window TEXT NOT NULL,
    scope_kind TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    installation_id TEXT NOT NULL REFERENCES plugin_installations(id),
    contribution_id TEXT NOT NULL,
    generation_id TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    deadline_ms INTEGER NOT NULL,
    finished_at TEXT
);
CREATE INDEX idx_capability_invocations_release ON capability_invocations(installation_id,status);
