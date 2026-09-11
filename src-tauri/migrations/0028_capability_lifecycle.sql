-- Logical identity survives process restarts and cache eviction; releases remain isolated.
CREATE TABLE capability_instances (
  id TEXT PRIMARY KEY NOT NULL,
  installation_id TEXT NOT NULL REFERENCES plugin_installations(id),
  contribution_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('application','workspace','session')),
  scope_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(installation_id,contribution_id,scope_kind,scope_id)
);
ALTER TABLE capability_invocations ADD COLUMN instance_id TEXT REFERENCES capability_instances(id);
-- Correlation survives deletion of a conversation. It never grants authority.
ALTER TABLE capability_invocations ADD COLUMN turn_id TEXT;

-- Host-owned immutable snapshots, independent of agent_events. Triggers make each
-- lifecycle transition and its event atomic, including startup recovery.
CREATE TABLE capability_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  invocation_id TEXT NOT NULL REFERENCES capability_invocations(id),
  caller_window TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX capability_events_owner_scope ON capability_events(caller_window,scope_kind,scope_id,sequence);

CREATE TRIGGER capability_invocation_admitted AFTER INSERT ON capability_invocations
BEGIN
  INSERT INTO capability_events(invocation_id,caller_window,scope_kind,scope_id,payload_json)
  VALUES(NEW.id,NEW.caller_window,NEW.scope_kind,NEW.scope_id,json_object(
    'schemaVersion','1.0','type','admitted','invocationId',NEW.id,
    'instanceId',NEW.instance_id,'installationId',NEW.installation_id,
    'contributionId',NEW.contribution_id,'capability',NEW.capability_id,
    'contractVersion',NEW.contract_version,
    'scope',CASE WHEN NEW.scope_kind='application' THEN json_object('kind','application') ELSE json_object('kind',NEW.scope_kind,'id',NEW.scope_id) END,
    'turnId',NEW.turn_id,'parentInvocationId',NEW.parent_invocation_id,
    'rootInvocationId',COALESCE(NEW.root_invocation_id,NEW.id),
    'generationId',NEW.generation_id,'status',NEW.status,'occurredAt',NEW.started_at));
END;

CREATE TRIGGER capability_invocation_transition AFTER UPDATE OF generation_id,status ON capability_invocations
WHEN OLD.generation_id IS NOT NEW.generation_id OR OLD.status IS NOT NEW.status
BEGIN
  INSERT INTO capability_events(invocation_id,caller_window,scope_kind,scope_id,payload_json)
  VALUES(NEW.id,NEW.caller_window,NEW.scope_kind,NEW.scope_id,json_object(
    'schemaVersion','1.0','type',CASE WHEN NEW.status='running' THEN 'started' ELSE 'finished' END,
    'invocationId',NEW.id,'instanceId',NEW.instance_id,
    'installationId',NEW.installation_id,'contributionId',NEW.contribution_id,
    'capability',NEW.capability_id,'contractVersion',NEW.contract_version,
    'scope',CASE WHEN NEW.scope_kind='application' THEN json_object('kind','application') ELSE json_object('kind',NEW.scope_kind,'id',NEW.scope_id) END,
    'turnId',NEW.turn_id,'parentInvocationId',NEW.parent_invocation_id,
    'rootInvocationId',COALESCE(NEW.root_invocation_id,NEW.id),
    'generationId',NEW.generation_id,'status',NEW.status,
    'occurredAt',COALESCE(NEW.finished_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))));
END;
