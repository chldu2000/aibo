-- Keep the normalized tool identifier next to each tool timeline item so the
-- UI can summarize calls without parsing or displaying the full output.
ALTER TABLE messages
  ADD COLUMN tool_name TEXT;
