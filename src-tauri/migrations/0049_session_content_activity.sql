-- Keep record maintenance separate from the time shown in session navigation.
ALTER TABLE sessions ADD COLUMN content_updated_at TEXT;

-- Old updated_at values include resume, rename and crash recovery. Reconstruct
-- activity from durable content evidence, never from that maintenance clock.
-- For legacy messages without events, creation is the safe known timestamp.
UPDATE sessions SET content_updated_at = COALESCE(
  (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', MAX(julianday(activity_at))) FROM (
    SELECT sessions.created_at AS activity_at
    UNION ALL
    SELECT m.created_at FROM messages m WHERE m.session_id = sessions.id
      AND m.status != 'queued' AND COALESCE(m.tool_name, '') != 'subagent'
    UNION ALL
    SELECT e.occurred_at FROM agent_events e WHERE e.session_id = sessions.id
      AND e.event_type IN ('message.delta', 'message.completed', 'reasoning.updated',
        'reasoning.completed', 'tool.started', 'tool.updated', 'tool.completed', 'subagent.message')
  )), created_at);

CREATE INDEX idx_sessions_workspace_content_activity
  ON sessions(workspace_id, julianday(COALESCE(content_updated_at, created_at)) DESC, id DESC);

CREATE TRIGGER session_content_insert AFTER INSERT ON messages
WHEN NEW.status != 'queued' AND COALESCE(NEW.tool_name, '') != 'subagent'
BEGIN
  UPDATE sessions SET content_updated_at = NEW.created_at
  WHERE id = NEW.session_id
    AND julianday(NEW.created_at) > julianday(COALESCE(content_updated_at, created_at));
END;

CREATE TRIGGER session_content_update AFTER UPDATE ON messages
WHEN NEW.status != 'queued' AND COALESCE(NEW.tool_name, '') != 'subagent'
  AND (NEW.content IS NOT OLD.content OR OLD.status = 'queued'
    OR NEW.tool_command IS NOT OLD.tool_command OR NEW.tool_cwd IS NOT OLD.tool_cwd
    OR NEW.tool_exit_code IS NOT OLD.tool_exit_code)
BEGIN
  UPDATE sessions SET content_updated_at = NEW.updated_at
  WHERE id = NEW.session_id
    AND julianday(NEW.updated_at) > julianday(COALESCE(content_updated_at, created_at));
END;

-- Child messages live in agent_events, not in the parent's messages table.
-- Repeated snapshots of the same content do not count as new activity.
CREATE TRIGGER session_child_content_insert AFTER INSERT ON agent_events
WHEN NEW.event_type = 'subagent.message'
  AND json_extract(NEW.payload_json, '$.payload.entry.content') IS NOT (
    SELECT json_extract(e.payload_json, '$.payload.entry.content') FROM agent_events e
    WHERE e.session_id = NEW.session_id AND e.event_type = 'subagent.message'
      AND e.event_id != NEW.event_id
      AND json_extract(e.payload_json, '$.payload.agentId') = json_extract(NEW.payload_json, '$.payload.agentId')
      AND json_extract(e.payload_json, '$.payload.entry.id') = json_extract(NEW.payload_json, '$.payload.entry.id')
    ORDER BY e.occurred_at DESC, e.sequence DESC LIMIT 1
  )
BEGIN
  UPDATE sessions SET content_updated_at = NEW.occurred_at
  WHERE id = NEW.session_id
    AND julianday(NEW.occurred_at) > julianday(COALESCE(content_updated_at, created_at));
END;
