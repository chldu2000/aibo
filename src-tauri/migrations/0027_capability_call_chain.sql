ALTER TABLE capability_invocations ADD COLUMN parent_invocation_id TEXT REFERENCES capability_invocations(id);
ALTER TABLE capability_invocations ADD COLUMN root_invocation_id TEXT;
ALTER TABLE capability_invocations ADD COLUMN caller_installation_id TEXT REFERENCES plugin_installations(id);
CREATE INDEX idx_capability_invocations_parent ON capability_invocations(parent_invocation_id);
