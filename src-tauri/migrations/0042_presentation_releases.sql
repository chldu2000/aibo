CREATE TABLE presentation_releases (
    digest TEXT PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    version TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    installed INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    UNIQUE(plugin_id, version)
);
CREATE TABLE presentation_selections (
    window_id TEXT PRIMARY KEY,
    digest TEXT REFERENCES presentation_releases(digest),
    theme_id TEXT
);
