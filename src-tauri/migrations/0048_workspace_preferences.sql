-- Host-owned defaults apply only when inserting a new workspace.
-- Existing per-workspace trust and permission epochs remain unchanged.
CREATE TABLE workspace_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    trust_new_workspaces INTEGER NOT NULL CHECK (trust_new_workspaces IN (0, 1))
);
INSERT INTO workspace_preferences (id, trust_new_workspaces) VALUES (1, 1);
