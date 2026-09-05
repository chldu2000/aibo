-- Queue entries are durable user-intent records while a Pi turn is active.
-- Rebuild the table because SQLite cannot alter an existing CHECK constraint.
CREATE TABLE messages_new (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  external_message_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('streaming', 'completed', 'failed', 'queued')),
  sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tool_name TEXT,
  tool_command TEXT,
  tool_cwd TEXT,
  tool_exit_code INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
  FOREIGN KEY (turn_id) REFERENCES turns (id) ON DELETE SET NULL
);

INSERT INTO messages_new
  (id, session_id, turn_id, external_message_id, role, content, status,
   sequence, created_at, updated_at, tool_name, tool_command, tool_cwd,
   tool_exit_code)
SELECT id, session_id, turn_id, external_message_id, role, content, status,
       sequence, created_at, updated_at, tool_name, tool_command, tool_cwd,
       tool_exit_code
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

CREATE UNIQUE INDEX idx_messages_external
  ON messages (session_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE INDEX idx_messages_session_created
  ON messages (session_id, created_at ASC, sequence ASC);
