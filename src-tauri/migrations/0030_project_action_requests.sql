-- Legacy runs have no request identity and are never used for deduplication.
ALTER TABLE project_action_runs ADD COLUMN request_id TEXT;
ALTER TABLE project_action_runs ADD COLUMN request_json TEXT CHECK (request_json IS NULL OR json_valid(request_json));
CREATE UNIQUE INDEX idx_project_action_request ON project_action_runs(workspace_id, request_id);
