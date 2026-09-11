"""Seed only the fresh, isolated native probe's completed turn; never start an Agent."""
import hashlib
import sqlite3
import sys
from datetime import datetime, timezone

database, workspace, head, baseline, changed = sys.argv[1:]
assert "/local.aibo.corehunk." in database, "Refuse a non-probe database"
now = datetime.now(timezone.utc).isoformat()
digest = lambda content: "sha256:" + hashlib.sha256(content.encode()).hexdigest()
with sqlite3.connect(database, timeout=15) as db:
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("INSERT INTO sessions (id,workspace_id,agent,label,state,created_at,updated_at) VALUES ('hunk-session',?,'pi','Hunk fixture','idle',?,?)", (workspace, now, now))
    db.execute("INSERT INTO turns (id,session_id,external_turn_id,status,started_at) VALUES ('hunk-turn','hunk-session','fixture','completed',?)", (now,))
    db.execute("INSERT INTO turn_change_sets (id,workspace_id,session_id,turn_id,schema_version,baseline_head,attribution,capture_status,created_at,updated_at) VALUES ('hunk-set',?,'hunk-session','hunk-turn','aibo.turn-changeset/v1',?,'agent','captured',?,?)", (workspace, head, now, now))
    db.execute("INSERT INTO file_changes (id,change_set_id,path,change_kind,baseline_exists,baseline_hash,result_exists,result_hash,created_at) VALUES ('hunk-file','hunk-set','file.txt','modified',1,?,1,?,?)", (digest(baseline), digest(changed), now))
