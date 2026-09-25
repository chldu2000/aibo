-- Complete the exact initial development version of migration 51. Also safe on
-- databases that already applied the final 51. Only derived search data changes.
-- Keep both 51 and its historical SQL immutable; future changes get new versions.
CREATE TABLE IF NOT EXISTS search_file_state (
 document_id TEXT PRIMARY KEY REFERENCES search_documents(id) ON DELETE CASCADE,
 signature TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS search_attachment_text_reset AFTER UPDATE ON attachments BEGIN
 DELETE FROM search_file_state WHERE document_id='attachment:' || NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS search_artifact_text_reset AFTER UPDATE ON artifacts BEGIN
 DELETE FROM search_file_state WHERE document_id='artifact:' || NEW.id;
END;

-- Audit content retains the same injected-window ownership as capability history.
INSERT INTO search_documents(id,kind,source,target_id,title,body,updated_at,owner_window)
SELECT 'capability-event:' || sequence,'execution','capability-event',CAST(sequence AS TEXT),
 COALESCE(json_extract(payload_json,'$.capability'),json_extract(payload_json,'$.type'),'插件调用'),payload_json,
 COALESCE(json_extract(payload_json,'$.occurredAt'),''),caller_window FROM capability_events WHERE 1
ON CONFLICT(id) DO NOTHING;
CREATE TRIGGER IF NOT EXISTS search_capability_event_insert AFTER INSERT ON capability_events BEGIN
 INSERT INTO search_documents(id,kind,source,target_id,title,body,updated_at,owner_window)
 VALUES('capability-event:' || NEW.sequence,'execution','capability-event',CAST(NEW.sequence AS TEXT),
 COALESCE(json_extract(NEW.payload_json,'$.capability'),json_extract(NEW.payload_json,'$.type'),'插件调用'),NEW.payload_json,
 COALESCE(json_extract(NEW.payload_json,'$.occurredAt'),''),NEW.caller_window);
END;
CREATE TRIGGER IF NOT EXISTS search_capability_event_delete AFTER DELETE ON capability_events BEGIN
 DELETE FROM search_documents WHERE id='capability-event:' || OLD.sequence;
END;

-- Reproject child messages with unambiguous composite identities.
DROP TRIGGER search_subagent_insert;
DROP TRIGGER search_subagent_delete;
DELETE FROM search_documents WHERE source='subagent';
INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'subagent:' || json_array(session_id,json_extract(payload_json,'$.payload.agentId'),json_extract(payload_json,'$.payload.entry.id')),'message','subagent',event_id,NULL,session_id,
 '子 Agent · ' || COALESCE(json_extract(payload_json,'$.payload.entry.toolName'),json_extract(payload_json,'$.payload.entry.role'),'消息'),
 COALESCE(json_extract(payload_json,'$.payload.entry.content'),''),occurred_at || printf('%020d',sequence),NULL FROM agent_events WHERE event_type='subagent.message' AND json_type(payload_json,'$.payload.entry.id')='text' AND json_type(payload_json,'$.payload.agentId')='text' ORDER BY occurred_at,sequence ON CONFLICT(id) DO UPDATE SET target_id=excluded.target_id,title=excluded.title,body=excluded.body,updated_at=excluded.updated_at
 WHERE excluded.updated_at >= search_documents.updated_at;

CREATE TRIGGER search_subagent_insert AFTER INSERT ON agent_events BEGIN
 INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'subagent:' || json_array(session_id,json_extract(payload_json,'$.payload.agentId'),json_extract(payload_json,'$.payload.entry.id')),'message','subagent',event_id,NULL,session_id,
 '子 Agent · ' || COALESCE(json_extract(payload_json,'$.payload.entry.toolName'),json_extract(payload_json,'$.payload.entry.role'),'消息'),
 COALESCE(json_extract(payload_json,'$.payload.entry.content'),''),occurred_at || printf('%020d',sequence),NULL FROM agent_events WHERE event_id=NEW.event_id AND event_type='subagent.message' AND json_type(payload_json,'$.payload.entry.id')='text' AND json_type(payload_json,'$.payload.agentId')='text' ON CONFLICT(id) DO UPDATE SET target_id=excluded.target_id,title=excluded.title,body=excluded.body,updated_at=excluded.updated_at
 WHERE excluded.updated_at >= search_documents.updated_at;
END;
CREATE TRIGGER search_subagent_delete AFTER DELETE ON agent_events BEGIN
 DELETE FROM search_documents WHERE source='subagent' AND target_id=OLD.event_id;
END;

