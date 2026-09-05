-- Preserve command execution facts alongside the normalized tool timeline.
-- Values are adapter-provided metadata and remain nullable for non-command tools
-- and historical messages.
ALTER TABLE messages ADD COLUMN tool_command TEXT;
ALTER TABLE messages ADD COLUMN tool_cwd TEXT;
ALTER TABLE messages ADD COLUMN tool_exit_code INTEGER;
