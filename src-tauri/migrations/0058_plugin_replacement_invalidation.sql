-- Host-side edits also end the undo window, even without a runtime invocation.
CREATE TRIGGER plugin_replacement_settings_delete AFTER DELETE ON agent_settings
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE plugin_id=OLD.plugin_id AND phase='ready';
END;
CREATE TRIGGER plugin_replacement_binding_insert AFTER INSERT ON capability_provider_bindings
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE target_id=NEW.installation_id AND phase='ready';
END;
CREATE TRIGGER plugin_replacement_binding_update AFTER UPDATE ON capability_provider_bindings
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE target_id IN (OLD.installation_id,NEW.installation_id) AND phase='ready';
END;
CREATE TRIGGER plugin_replacement_binding_delete AFTER DELETE ON capability_provider_bindings
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE target_id=OLD.installation_id AND phase='ready';
END;
CREATE TRIGGER plugin_replacement_installation_change AFTER UPDATE OF installed,enabled ON plugin_installations
WHEN NEW.installed<>OLD.installed OR NEW.enabled<>OLD.enabled
BEGIN
    UPDATE plugin_replacements SET phase='expired' WHERE target_id=NEW.id AND phase='ready';
END;
