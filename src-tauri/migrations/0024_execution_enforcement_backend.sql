-- Host-owned policy, separate from a plugin's optional capabilities.
-- Preserve old host-saved Core grants using enforced values, never requested values.
ALTER TABLE session_execution_profiles ADD COLUMN enforcement_backend TEXT NOT NULL DEFAULT '"unnegotiated"'
  CHECK (enforcement_backend IN ('"codex-native"', '"core-proxy"', '"unnegotiated"'));

UPDATE session_execution_profiles SET enforcement_backend = CASE
  WHEN (SELECT agent FROM sessions WHERE id = session_id) IN ('codex', 'dev.aibo.codex.agent') THEN '"codex-native"'
  WHEN (SELECT agent FROM sessions WHERE id = session_id) IN ('pi', 'dev.aibo.pi.agent') THEN '"core-proxy"'
  WHEN native_sandbox = 0 AND (
    json_extract(enforced_json, '$.filesystemPolicy') = 'workspace-write'
    OR json_extract(enforced_json, '$.commandPolicy') IN ('approved', 'trusted')
  ) THEN '"core-proxy"'
  ELSE '"unnegotiated"'
END;
