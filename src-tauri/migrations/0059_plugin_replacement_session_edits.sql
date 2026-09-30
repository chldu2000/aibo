-- Recovery and execution settings may change before a runtime invocation begins.
CREATE TRIGGER plugin_replacement_session_rebind AFTER UPDATE OF plugin_installation_id ON sessions
WHEN NEW.plugin_installation_id IS NOT OLD.plugin_installation_id
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE phase='ready'
        AND target_id IN (OLD.plugin_installation_id,NEW.plugin_installation_id);
END;
CREATE TRIGGER plugin_replacement_recovery_edit AFTER UPDATE ON session_bindings
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE phase='ready' AND target_id IN
        (SELECT plugin_installation_id FROM sessions WHERE id=NEW.session_id);
END;
CREATE TRIGGER plugin_replacement_profile_edit AFTER UPDATE ON session_execution_profiles
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE phase='ready' AND target_id IN
        (SELECT plugin_installation_id FROM sessions WHERE id=NEW.session_id);
END;
CREATE TRIGGER plugin_replacement_queue_insert AFTER INSERT ON queued_messages
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE phase='ready' AND target_id IN
        (SELECT plugin_installation_id FROM sessions WHERE id=NEW.session_id);
END;
