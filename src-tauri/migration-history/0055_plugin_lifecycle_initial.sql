CREATE TABLE plugin_upgrade_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    policy TEXT NOT NULL CHECK (policy IN ('automatic', 'ask', 'pinned'))
);
INSERT INTO plugin_upgrade_preferences VALUES (1, 'automatic');

CREATE TABLE plugin_removals (
    installation_id TEXT PRIMARY KEY REFERENCES plugin_installations(id),
    requested_at TEXT NOT NULL
);

-- History-only is permanent even if the exact package is installed again.
CREATE TABLE plugin_session_retirements (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    retired_at TEXT NOT NULL
);

CREATE TABLE plugin_session_migrations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    from_installation_id TEXT NOT NULL REFERENCES plugin_installations(id),
    to_installation_id TEXT NOT NULL REFERENCES plugin_installations(id),
    previous_binding_json TEXT CHECK (previous_binding_json IS NULL OR json_valid(previous_binding_json)),
    migrated_at TEXT NOT NULL
);
