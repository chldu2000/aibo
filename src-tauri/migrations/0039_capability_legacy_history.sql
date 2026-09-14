-- Preserve pre-lifecycle invocations without inventing events that were never recorded.
-- This archive is read only by host history; capability_events and its v1 stream stay unchanged.
CREATE TABLE capability_legacy_history (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  invocation_id TEXT NOT NULL UNIQUE REFERENCES capability_invocations(id),
  caller_window TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX capability_legacy_history_owner_scope ON capability_legacy_history(caller_window,scope_kind,scope_id,sequence);
INSERT INTO capability_legacy_history(invocation_id,caller_window,scope_kind,scope_id,payload_json)
SELECT i.id,i.caller_window,i.scope_kind,i.scope_id,json_object(
  'schemaVersion','legacy-snapshot/1.0','type','legacy_snapshot',
  'invocationId',i.id,'installationId',i.installation_id,'contributionId',i.contribution_id,
  'capability',i.capability_id,'contractVersion',i.contract_version,
  'scope',CASE WHEN i.scope_kind='application' THEN json_object('kind','application') ELSE json_object('kind',i.scope_kind,'id',i.scope_id) END,
  'instanceId',i.instance_id,'generationId',i.generation_id,'parentInvocationId',i.parent_invocation_id,
  'rootInvocationId',i.root_invocation_id,'turnId',i.turn_id,
  'callerInstallationId',i.caller_installation_id,'writeRunId',i.write_run_id,'deadlineMs',i.deadline_ms,
  'status',i.status,'startedAt',i.started_at,'finishedAt',i.finished_at)
FROM capability_invocations i
WHERE NOT EXISTS (SELECT 1 FROM capability_events e WHERE e.invocation_id=i.id)
ORDER BY i.started_at,i.id;
