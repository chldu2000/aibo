-- Package dependency pins are independent of capability provider selection.
-- Tombstoned releases remain referenced; never silently choose a replacement.
CREATE TABLE plugin_dependency_bindings (
    installation_id TEXT NOT NULL REFERENCES plugin_installations(id),
    dependency_plugin_id TEXT NOT NULL,
    dependency_installation_id TEXT NOT NULL REFERENCES plugin_installations(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (installation_id, dependency_plugin_id)
);
CREATE INDEX idx_plugin_dependency_release ON plugin_dependency_bindings(dependency_installation_id);
