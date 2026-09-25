-- Migration 49 has already shipped to development databases; keep its bytes
-- unchanged so SQLx can validate their history. Remove the expression index in
-- a forward migration: SQLite rejects date expressions for values such as 'now'.
DROP INDEX IF EXISTS idx_sessions_workspace_content_activity;
