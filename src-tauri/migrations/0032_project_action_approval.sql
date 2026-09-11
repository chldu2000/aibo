-- Approval must settle before a run can enter the side-effecting state.
ALTER TABLE project_action_runs RENAME TO project_action_runs_before_approval;
CREATE TABLE project_action_runs (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version TEXT NOT NULL,
  action_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_approval','running','rejected','completed','failed','timed_out','outcome_unknown')),
  exit_code INTEGER,
  output TEXT NOT NULL,
  artifact_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  request_id TEXT,
  request_json TEXT CHECK (request_json IS NULL OR json_valid(request_json)),
  cancel_requested_at TEXT,
  approval_outcome TEXT CHECK (approval_outcome IS NULL OR approval_outcome IN ('approved','denied','cancelled','expired','stale','unavailable','recovered')),
  approval_decided_at TEXT
);
INSERT INTO project_action_runs
SELECT id,schema_version,action_id,workspace_id,session_id,status,exit_code,output,artifact_id,
       started_at,completed_at,snapshot_json,request_id,request_json,cancel_requested_at,NULL,NULL
FROM project_action_runs_before_approval;
DROP TABLE project_action_runs_before_approval;
CREATE INDEX idx_project_action_runs_workspace ON project_action_runs(workspace_id, started_at DESC);
CREATE UNIQUE INDEX idx_project_action_request ON project_action_runs(workspace_id, request_id);
