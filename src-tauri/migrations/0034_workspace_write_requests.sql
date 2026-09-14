-- Old runs have no client request identity and remain readable as history.
ALTER TABLE workspace_write_runs ADD COLUMN request_id TEXT;
ALTER TABLE workspace_write_runs ADD COLUMN caller_window TEXT;
ALTER TABLE workspace_write_runs ADD COLUMN request_json TEXT CHECK (request_json IS NULL OR json_valid(request_json));
CREATE UNIQUE INDEX idx_workspace_write_request ON workspace_write_runs(workspace_id, request_id);
