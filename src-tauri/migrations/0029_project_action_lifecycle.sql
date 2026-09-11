-- Preserve old completed records and decouple execution history from task definitions.
ALTER TABLE project_action_runs RENAME TO project_action_runs_legacy;
CREATE TABLE project_action_runs (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version TEXT NOT NULL,
  action_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','timed_out','outcome_unknown')),
  exit_code INTEGER,
  output TEXT NOT NULL,
  artifact_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);
INSERT INTO project_action_runs
SELECT r.id,r.schema_version,r.action_id,r.workspace_id,r.session_id,r.status,r.exit_code,
       r.output,r.artifact_id,r.started_at,r.completed_at,
       json_object('schema','aibo.project-action-snapshot/v1','origin','migration-current-definition','definition',json_object('id',a.id,'name',a.name,'kind',a.kind,'program',a.program,'args',json(a.args_json),'cwd',a.cwd))
FROM project_action_runs_legacy r JOIN project_actions a ON a.id=r.action_id;
DROP TABLE project_action_runs_legacy;
CREATE INDEX idx_project_action_runs_workspace ON project_action_runs(workspace_id, started_at DESC);
