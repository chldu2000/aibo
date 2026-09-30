-- Durable all-or-nothing replacement and short-lived undo records.
CREATE TABLE plugin_replacements (
    plugin_id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
    phase TEXT NOT NULL CHECK(phase IN ('preparing','ready','expired')),
    created_at TEXT NOT NULL
);

-- A plugin invocation may mutate private data even if its public effect is read.
CREATE TRIGGER plugin_replacement_used AFTER INSERT ON capability_invocations
WHEN NEW.caller_window <> 'plugin-upgrade'
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE target_id=NEW.installation_id AND phase='ready';
END;
CREATE TRIGGER plugin_replacement_new_session AFTER INSERT ON sessions
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE target_id=NEW.plugin_installation_id AND phase='ready';
END;
CREATE TRIGGER plugin_replacement_deleted_session BEFORE DELETE ON sessions
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE target_id=OLD.plugin_installation_id AND phase='ready';
END;
CREATE TRIGGER plugin_replacement_new_message AFTER INSERT ON messages
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE phase='ready' AND target_id IN
        (SELECT plugin_installation_id FROM sessions WHERE id=NEW.session_id);
END;
CREATE TRIGGER plugin_replacement_edited_message AFTER UPDATE ON messages
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE phase='ready' AND target_id IN
        (SELECT plugin_installation_id FROM sessions WHERE id=NEW.session_id);
END;
CREATE TRIGGER plugin_replacement_settings AFTER UPDATE ON agent_settings
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE plugin_id=NEW.plugin_id AND phase='ready';
END;
CREATE TRIGGER plugin_replacement_settings_insert AFTER INSERT ON agent_settings
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE plugin_id=NEW.plugin_id AND phase='ready';
END;
CREATE TRIGGER plugin_replacement_expired AFTER UPDATE OF phase ON plugin_replacements
WHEN NEW.phase='expired'
BEGIN
    INSERT OR IGNORE INTO plugin_removals(installation_id,requested_at)
        SELECT json_extract(value,'$.id'),NEW.created_at FROM json_each(NEW.snapshot_json,'$.releases');
END;
