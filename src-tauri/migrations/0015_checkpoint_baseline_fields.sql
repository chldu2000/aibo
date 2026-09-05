-- Preserve enough baseline state to reconstruct an interrupted turn after a
-- restart. Per-file dirty attribution is intentionally separate from the
-- snapshot-wide dirty flag.
ALTER TABLE checkpoints ADD COLUMN baseline_head TEXT;
ALTER TABLE checkpoints ADD COLUMN baseline_dirty INTEGER NOT NULL DEFAULT 0 CHECK (baseline_dirty IN (0, 1));
