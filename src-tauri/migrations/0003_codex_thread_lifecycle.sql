-- Phase 2 records Codex branch ancestry and keeps remote archive state
-- distinct from a locally closed session.
ALTER TABLE sessions
  ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));

ALTER TABLE session_bindings
  ADD COLUMN parent_external_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_session_bindings_parent
  ON session_bindings (parent_external_session_id);
