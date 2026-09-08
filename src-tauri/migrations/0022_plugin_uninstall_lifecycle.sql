ALTER TABLE plugin_installations ADD COLUMN installed INTEGER NOT NULL DEFAULT 1 CHECK (installed IN (0, 1));
ALTER TABLE plugin_installations ADD COLUMN removed_at TEXT;
