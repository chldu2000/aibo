-- Keep the composer draft in the same durable store as the session it belongs
-- to. The WebView localStorage copy remains a fast fallback for preview mode,
-- while desktop sessions use this row across app restarts.
CREATE TABLE IF NOT EXISTS composer_drafts (
  session_id TEXT PRIMARY KEY NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'aibo.composer-draft/v1',
  text TEXT NOT NULL,
  send_failed INTEGER NOT NULL DEFAULT 0 CHECK (send_failed IN (0, 1)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_composer_drafts_updated
  ON composer_drafts (updated_at DESC);
