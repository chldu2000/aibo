ALTER TABLE attachments
ADD COLUMN schema_version TEXT NOT NULL DEFAULT 'aibo.context-attachment/v1';
