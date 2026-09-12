-- A replacement is not a confirmed binding until its runtime negotiates successfully.
CREATE TABLE capability_binding_candidates (
    scope_kind TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    candidate_id TEXT NOT NULL UNIQUE,
    installation_id TEXT NOT NULL REFERENCES plugin_installations(id),
    contribution_id TEXT NOT NULL,
    PRIMARY KEY(scope_kind,scope_id,capability_id,contract_version),
    FOREIGN KEY(scope_kind,scope_id,capability_id,contract_version)
      REFERENCES capability_provider_bindings(scope_kind,scope_id,capability_id,contract_version) ON DELETE CASCADE
);
