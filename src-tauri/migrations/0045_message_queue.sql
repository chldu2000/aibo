CREATE TABLE session_queues (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    paused INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE queued_messages (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    caller TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','failed','uncertain')),
    error TEXT,
    turn_id TEXT,
    delivery TEXT NOT NULL DEFAULT 'turn',
    created_at TEXT NOT NULL
);
CREATE INDEX queued_messages_session ON queued_messages(session_id, created_at, id);
ALTER TABLE attachments ADD COLUMN queued_message_id TEXT REFERENCES queued_messages(id) ON DELETE SET NULL;
