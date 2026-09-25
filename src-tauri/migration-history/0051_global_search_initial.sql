-- Rebuildable host-owned projections. FTS trigram supports Chinese substrings;
-- one/two-character queries fall back to literal LIKE on the same projection.
CREATE TABLE search_documents (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  target_id TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  owner_window TEXT
);
CREATE INDEX idx_search_documents_scope ON search_documents(workspace_id,session_id,kind);
CREATE VIRTUAL TABLE search_fts USING fts5(title,body,content='search_documents',content_rowid='rowid',tokenize='trigram');
CREATE TRIGGER search_documents_insert AFTER INSERT ON search_documents BEGIN
  INSERT INTO search_fts(rowid,title,body) VALUES(NEW.rowid,NEW.title,NEW.body);
END;
CREATE TRIGGER search_documents_delete AFTER DELETE ON search_documents BEGIN
  INSERT INTO search_fts(search_fts,rowid,title,body) VALUES('delete',OLD.rowid,OLD.title,OLD.body);
END;
CREATE TRIGGER search_documents_update AFTER UPDATE OF title,body ON search_documents
WHEN OLD.title IS NOT NEW.title OR OLD.body IS NOT NEW.body BEGIN
  INSERT INTO search_fts(search_fts,rowid,title,body) VALUES('delete',OLD.rowid,OLD.title,OLD.body);
  INSERT INTO search_fts(rowid,title,body) VALUES(NEW.rowid,NEW.title,NEW.body);
END;

INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'workspace:' || id,'workspace','workspace',id,id,NULL,label,path,COALESCE(last_opened_at,updated_at),NULL FROM workspaces;

CREATE TRIGGER search_workspaces_insert AFTER INSERT ON workspaces BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'workspace:' || id,'workspace','workspace',id,id,NULL,label,path,COALESCE(last_opened_at,updated_at),NULL FROM workspaces WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_workspaces_update AFTER UPDATE ON workspaces BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'workspace:' || id,'workspace','workspace',id,id,NULL,label,path,COALESCE(last_opened_at,updated_at),NULL FROM workspaces WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_workspaces_delete AFTER DELETE ON workspaces BEGIN
  DELETE FROM search_documents WHERE id='workspace:' || OLD.id;
END;

INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'session:' || id,'session','session',id,workspace_id,id,label,agent,COALESCE(content_updated_at,created_at),NULL FROM sessions;

CREATE TRIGGER search_sessions_insert AFTER INSERT ON sessions BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'session:' || id,'session','session',id,workspace_id,id,label,agent,COALESCE(content_updated_at,created_at),NULL FROM sessions WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_sessions_update AFTER UPDATE ON sessions BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'session:' || id,'session','session',id,workspace_id,id,label,agent,COALESCE(content_updated_at,created_at),NULL FROM sessions WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_sessions_delete AFTER DELETE ON sessions BEGIN
  DELETE FROM search_documents WHERE id='session:' || OLD.id;
END;

INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'message:' || id,'message','message',id,NULL,session_id,COALESCE(tool_name,role),content,updated_at,NULL FROM messages;

CREATE TRIGGER search_messages_insert AFTER INSERT ON messages BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'message:' || id,'message','message',id,NULL,session_id,COALESCE(tool_name,role),content,updated_at,NULL FROM messages WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_messages_update AFTER UPDATE ON messages BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'message:' || id,'message','message',id,NULL,session_id,COALESCE(tool_name,role),content,updated_at,NULL FROM messages WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_messages_delete AFTER DELETE ON messages BEGIN
  DELETE FROM search_documents WHERE id='message:' || OLD.id;
END;

INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'attachment:' || id,'attachment','attachment',id,workspace_id,session_id,path,media_type || ' ' || source,created_at,NULL FROM attachments;

CREATE TRIGGER search_attachments_insert AFTER INSERT ON attachments BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'attachment:' || id,'attachment','attachment',id,workspace_id,session_id,path,media_type || ' ' || source,created_at,NULL FROM attachments WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_attachments_update AFTER UPDATE ON attachments BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'attachment:' || id,'attachment','attachment',id,workspace_id,session_id,path,media_type || ' ' || source,created_at,NULL FROM attachments WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_attachments_delete AFTER DELETE ON attachments BEGIN
  DELETE FROM search_documents WHERE id='attachment:' || OLD.id;
END;

INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'artifact:' || id,'artifact','artifact',id,workspace_id,session_id,source,media_type || ' ' || id,created_at,NULL FROM artifacts;

CREATE TRIGGER search_artifacts_insert AFTER INSERT ON artifacts BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'artifact:' || id,'artifact','artifact',id,workspace_id,session_id,source,media_type || ' ' || id,created_at,NULL FROM artifacts WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_artifacts_update AFTER UPDATE ON artifacts BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'artifact:' || id,'artifact','artifact',id,workspace_id,session_id,source,media_type || ' ' || id,created_at,NULL FROM artifacts WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_artifacts_delete AFTER DELETE ON artifacts BEGIN
  DELETE FROM search_documents WHERE id='artifact:' || OLD.id;
END;

INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'project-action:' || id,'execution','project-action',id,workspace_id,NULL,name,program || ' ' || args_json || ' ' || kind,updated_at,NULL FROM project_actions;

CREATE TRIGGER search_project_actions_insert AFTER INSERT ON project_actions BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'project-action:' || id,'execution','project-action',id,workspace_id,NULL,name,program || ' ' || args_json || ' ' || kind,updated_at,NULL FROM project_actions WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_project_actions_update AFTER UPDATE ON project_actions BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'project-action:' || id,'execution','project-action',id,workspace_id,NULL,name,program || ' ' || args_json || ' ' || kind,updated_at,NULL FROM project_actions WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_project_actions_delete AFTER DELETE ON project_actions BEGIN
  DELETE FROM search_documents WHERE id='project-action:' || OLD.id;
END;

INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'project-run:' || id,'execution','project-run',id,workspace_id,session_id,action_id || ' · ' || status,output,started_at,NULL FROM project_action_runs;

CREATE TRIGGER search_project_action_runs_insert AFTER INSERT ON project_action_runs BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'project-run:' || id,'execution','project-run',id,workspace_id,session_id,action_id || ' · ' || status,output,started_at,NULL FROM project_action_runs WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_project_action_runs_update AFTER UPDATE ON project_action_runs BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'project-run:' || id,'execution','project-run',id,workspace_id,session_id,action_id || ' · ' || status,output,started_at,NULL FROM project_action_runs WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_project_action_runs_delete AFTER DELETE ON project_action_runs BEGIN
  DELETE FROM search_documents WHERE id='project-run:' || OLD.id;
END;

INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'workspace-write:' || id,'execution','workspace-write',id,workspace_id,NULL,operation || ' · ' || status,snapshot_json || ' ' || COALESCE(result_json,''),started_at,NULL FROM workspace_write_runs;

CREATE TRIGGER search_workspace_write_runs_insert AFTER INSERT ON workspace_write_runs BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'workspace-write:' || id,'execution','workspace-write',id,workspace_id,NULL,operation || ' · ' || status,snapshot_json || ' ' || COALESCE(result_json,''),started_at,NULL FROM workspace_write_runs WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_workspace_write_runs_update AFTER UPDATE ON workspace_write_runs BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'workspace-write:' || id,'execution','workspace-write',id,workspace_id,NULL,operation || ' · ' || status,snapshot_json || ' ' || COALESCE(result_json,''),started_at,NULL FROM workspace_write_runs WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_workspace_write_runs_delete AFTER DELETE ON workspace_write_runs BEGIN
  DELETE FROM search_documents WHERE id='workspace-write:' || OLD.id;
END;

INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'capability:' || id,'execution','capability',id,NULL,NULL,capability_id || ' · ' || status,contribution_id || ' ' || scope_kind || ' ' || scope_id,started_at,caller_window FROM capability_invocations;

CREATE TRIGGER search_capability_invocations_insert AFTER INSERT ON capability_invocations BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'capability:' || id,'execution','capability',id,NULL,NULL,capability_id || ' · ' || status,contribution_id || ' ' || scope_kind || ' ' || scope_id,started_at,caller_window FROM capability_invocations WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_capability_invocations_update AFTER UPDATE ON capability_invocations BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'capability:' || id,'execution','capability',id,NULL,NULL,capability_id || ' · ' || status,contribution_id || ' ' || scope_kind || ' ' || scope_id,started_at,caller_window FROM capability_invocations WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_capability_invocations_delete AFTER DELETE ON capability_invocations BEGIN
  DELETE FROM search_documents WHERE id='capability:' || OLD.id;
END;

INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'plugin:' || id,'plugin','plugin',id,NULL,NULL,COALESCE(json_extract(manifest_json,'$.displayName'),plugin_id),plugin_id || ' ' || plugin_version || ' ' || COALESCE(json_extract(manifest_json,'$.description'),''),created_at,NULL FROM plugin_installations;

CREATE TRIGGER search_plugin_installations_insert AFTER INSERT ON plugin_installations BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'plugin:' || id,'plugin','plugin',id,NULL,NULL,COALESCE(json_extract(manifest_json,'$.displayName'),plugin_id),plugin_id || ' ' || plugin_version || ' ' || COALESCE(json_extract(manifest_json,'$.description'),''),created_at,NULL FROM plugin_installations WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_plugin_installations_update AFTER UPDATE ON plugin_installations BEGIN
  INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'plugin:' || id,'plugin','plugin',id,NULL,NULL,COALESCE(json_extract(manifest_json,'$.displayName'),plugin_id),plugin_id || ' ' || plugin_version || ' ' || COALESCE(json_extract(manifest_json,'$.description'),''),created_at,NULL FROM plugin_installations WHERE id=NEW.id
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
    workspace_id=excluded.workspace_id,session_id=excluded.session_id,owner_window=excluded.owner_window;
END;

CREATE TRIGGER search_plugin_installations_delete AFTER DELETE ON plugin_installations BEGIN
  DELETE FROM search_documents WHERE id='plugin:' || OLD.id;
END;

INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'subagent:' || session_id || ':' || json_extract(payload_json,'$.payload.agentId') || ':' || json_extract(payload_json,'$.payload.entry.id'),'message','subagent',event_id,NULL,session_id,
 '子 Agent · ' || COALESCE(json_extract(payload_json,'$.payload.entry.toolName'),json_extract(payload_json,'$.payload.entry.role'),'消息'),
 COALESCE(json_extract(payload_json,'$.payload.entry.content'),''),occurred_at || printf('%020d',sequence),NULL FROM agent_events WHERE event_type='subagent.message' AND json_type(payload_json,'$.payload.entry.id')='text' AND json_type(payload_json,'$.payload.agentId')='text' ORDER BY occurred_at,sequence ON CONFLICT(id) DO UPDATE SET target_id=excluded.target_id,title=excluded.title,body=excluded.body,updated_at=excluded.updated_at
 WHERE excluded.updated_at >= search_documents.updated_at;

CREATE TRIGGER search_subagent_insert AFTER INSERT ON agent_events BEGIN
 INSERT INTO search_documents(id,kind,source,target_id,workspace_id,session_id,title,body,updated_at,owner_window) SELECT 'subagent:' || session_id || ':' || json_extract(payload_json,'$.payload.agentId') || ':' || json_extract(payload_json,'$.payload.entry.id'),'message','subagent',event_id,NULL,session_id,
 '子 Agent · ' || COALESCE(json_extract(payload_json,'$.payload.entry.toolName'),json_extract(payload_json,'$.payload.entry.role'),'消息'),
 COALESCE(json_extract(payload_json,'$.payload.entry.content'),''),occurred_at || printf('%020d',sequence),NULL FROM agent_events WHERE event_id=NEW.event_id AND event_type='subagent.message' AND json_type(payload_json,'$.payload.entry.id')='text' AND json_type(payload_json,'$.payload.agentId')='text' ON CONFLICT(id) DO UPDATE SET target_id=excluded.target_id,title=excluded.title,body=excluded.body,updated_at=excluded.updated_at
 WHERE excluded.updated_at >= search_documents.updated_at;
END;
CREATE TRIGGER search_subagent_delete AFTER DELETE ON agent_events BEGIN
 DELETE FROM search_documents WHERE source='subagent' AND target_id=OLD.event_id;
END;
