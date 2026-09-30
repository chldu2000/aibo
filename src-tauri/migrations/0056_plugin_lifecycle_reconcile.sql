-- Both known applied versions of 0055 converge here without changing history.
CREATE TABLE IF NOT EXISTS presentation_removals (
    digest TEXT PRIMARY KEY REFERENCES presentation_releases(digest)
);

CREATE TABLE IF NOT EXISTS plugin_session_candidates (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    installation_id TEXT NOT NULL REFERENCES plugin_installations(id)
);
