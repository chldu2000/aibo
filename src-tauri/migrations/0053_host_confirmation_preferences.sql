-- Host operation confirmations are independent of workspace trust and Agent approvals.
CREATE TABLE host_confirmation_preferences (
    category TEXT PRIMARY KEY CHECK (category IN ('git', 'projectAction', 'turnRestore', 'capabilityWrite', 'viewWrite')),
    policy TEXT NOT NULL CHECK (policy IN ('always-allow', 'ask'))
);
INSERT INTO host_confirmation_preferences (category, policy) VALUES
    ('git', 'always-allow'),
    ('projectAction', 'always-allow'),
    ('turnRestore', 'always-allow'),
    ('capabilityWrite', 'always-allow'),
    ('viewWrite', 'always-allow');
