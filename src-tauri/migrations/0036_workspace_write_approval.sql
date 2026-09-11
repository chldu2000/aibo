CREATE TABLE workspace_write_runs_next (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_approval','rejected','running','completed','failed','outcome_unknown')),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  request_id TEXT,
  caller_window TEXT,
  request_json TEXT CHECK (request_json IS NULL OR json_valid(request_json)),
  cancel_requested_at TEXT,
  approval_outcome TEXT CHECK (approval_outcome IS NULL OR approval_outcome IN ('approved','denied','cancelled','expired','stale','unavailable','recovered')),
  approval_decided_at TEXT
);
INSERT INTO workspace_write_runs_next (id,schema_version,workspace_id,operation,status,snapshot_json,result_json,started_at,completed_at,request_id,caller_window,request_json,cancel_requested_at)
SELECT id,schema_version,workspace_id,operation,status,snapshot_json,result_json,started_at,completed_at,request_id,caller_window,request_json,cancel_requested_at FROM workspace_write_runs;
DROP TABLE workspace_write_runs;
ALTER TABLE workspace_write_runs_next RENAME TO workspace_write_runs;
CREATE INDEX idx_workspace_write_runs_history ON workspace_write_runs(workspace_id, started_at DESC, id DESC);
CREATE UNIQUE INDEX idx_workspace_write_request ON workspace_write_runs(workspace_id, request_id);
