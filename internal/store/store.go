// Package store persists workspaces, sessions and messages in one SQLite
// database inside the data directory. Sessions are append-only: a message
// may only change while it is streaming.
package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"

	_ "modernc.org/sqlite"
)

// DBFile is the database's file name inside the data directory.
const DBFile = "aibo.db"

// ErrDuplicatePath is returned when a workspace's path is already added.
var ErrDuplicatePath = errors.New("store: workspace path already added")

// ErrMessageEnded is returned when updating a message that has ended.
var ErrMessageEnded = errors.New("store: message has ended and can no longer change")

// Store is the open database.
type Store struct {
	db *sql.DB
}

// Open opens (creating if needed) the database in dir and brings its
// schema up to date.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	dsn := "file:" + filepath.Join(dir, DBFile) + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// One connection: SQLite serializes writers anyway, and this keeps
	// the pragmas and transactions simple.
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.backupBeforeUpgrade(dir); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// migrations bring the schema from version i to i+1. Never edit one that
// has shipped; append a new one.
var migrations = []string{
	`CREATE TABLE workspaces (
		id         TEXT PRIMARY KEY,
		path       TEXT NOT NULL UNIQUE,
		created_at INTEGER NOT NULL
	);
	CREATE TABLE sessions (
		id           TEXT PRIMARY KEY,
		workspace_id TEXT NOT NULL REFERENCES workspaces(id),
		agent        TEXT NOT NULL,
		model        TEXT NOT NULL DEFAULT '',
		title        TEXT NOT NULL DEFAULT '',
		title_manual INTEGER NOT NULL DEFAULT 0,
		created_at   INTEGER NOT NULL,
		active_at    INTEGER NOT NULL,
		next_seq     INTEGER NOT NULL DEFAULT 1
	);
	CREATE TABLE native_sessions (
		session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		idx        INTEGER NOT NULL,
		native_id  TEXT NOT NULL,
		started_at INTEGER NOT NULL,
		PRIMARY KEY (session_id, idx)
	);
	CREATE TABLE messages (
		session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		seq         INTEGER NOT NULL,
		kind        TEXT NOT NULL,
		state       TEXT NOT NULL,
		text        TEXT NOT NULL DEFAULT '',
		thinking    TEXT NOT NULL DEFAULT '',
		raw         TEXT,
		created_at  INTEGER NOT NULL,
		finished_at INTEGER,
		PRIMARY KEY (session_id, seq)
	);`,
	// References. A reference outlives its source session (reads then
	// say the source was deleted), but not its receiving session.
	`CREATE TABLE session_refs (
		id               TEXT PRIMARY KEY,
		source_id        TEXT NOT NULL,
		source_title     TEXT NOT NULL,
		source_agent     TEXT NOT NULL,
		source_workspace TEXT NOT NULL,
		from_seq         INTEGER NOT NULL,
		to_seq           INTEGER NOT NULL,
		count            INTEGER NOT NULL,
		target_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		brief            TEXT NOT NULL,
		state            TEXT NOT NULL,
		message_seq      INTEGER,
		position         INTEGER NOT NULL DEFAULT 0,
		created_at       INTEGER NOT NULL
	);
	CREATE INDEX session_refs_target ON session_refs(target_id);
	CREATE TABLE ref_reads (
		ref_id   TEXT NOT NULL REFERENCES session_refs(id) ON DELETE CASCADE,
		from_seq INTEGER NOT NULL,
		to_seq   INTEGER NOT NULL,
		at       INTEGER NOT NULL
	);
	CREATE INDEX ref_reads_ref ON ref_reads(ref_id);`,
	// What a message has besides text: a tool call, a plan, a subagent's
	// messages.
	`ALTER TABLE messages ADD COLUMN detail TEXT;`,
	// Approval levels and the rules allowed for the rest of a session.
	`ALTER TABLE sessions ADD COLUMN approval_level TEXT NOT NULL DEFAULT 'ask';
	ALTER TABLE sessions ADD COLUMN rules TEXT;`,
	// Markers of compactions and context resets, between messages.
	`CREATE TABLE markers (
		session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		after_seq   INTEGER NOT NULL,
		kind        TEXT NOT NULL,
		trigger     TEXT NOT NULL DEFAULT '',
		pre_tokens  INTEGER NOT NULL DEFAULT 0,
		post_tokens INTEGER NOT NULL DEFAULT 0,
		at          INTEGER NOT NULL
	);
	CREATE INDEX markers_session ON markers(session_id);`,
	// The user's settings.
	`CREATE TABLE settings (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);`,
	// Archived sessions, removed workspaces.
	`ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE workspaces ADD COLUMN removed INTEGER NOT NULL DEFAULT 0;`,
	// Other workspaces a session may read.
	`ALTER TABLE sessions ADD COLUMN read_dirs TEXT;`,
	// A session's reasoning effort, beside its model.
	`ALTER TABLE sessions ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT '';`,
	// Approval levels become the Agents' own permission modes (ADR 0003):
	// the column keeps its name. Codex's ask and edits were the same.
	`UPDATE sessions SET approval_level = CASE approval_level
		WHEN 'ask' THEN 'default' WHEN 'edits' THEN 'acceptEdits' WHEN 'auto' THEN 'bypassPermissions' ELSE approval_level END
		WHERE agent = 'claude';
	UPDATE sessions SET approval_level = CASE approval_level
		WHEN 'ask' THEN 'ask-for-approval' WHEN 'edits' THEN 'ask-for-approval' WHEN 'auto' THEN 'full-access' ELSE approval_level END
		WHERE agent = 'codex';`,
}

// backupBeforeUpgrade copies the database of an older schema, before
// it is upgraded, to aibo.db.v<version>-<time>.bak beside it.
func (s *Store) backupBeforeUpgrade(dir string) error {
	var v int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return err
	}
	if v == 0 || v >= len(migrations) {
		return nil
	}
	// The whole database in its file, the WAL emptied into it.
	if _, err := s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		return err
	}
	name := fmt.Sprintf("%s.v%d-%s.bak", DBFile, v, time.Now().Format("20060102-150405"))
	if _, err := s.db.Exec(`VACUUM INTO ?`, filepath.Join(dir, name)); err != nil {
		return fmt.Errorf("store: backing up before the upgrade: %w", err)
	}
	return nil
}

// Setting reads the setting key into v; ok is false when it is not set.
func (s *Store) Setting(key string, v any) (ok bool, err error) {
	var raw string
	err = s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal([]byte(raw), v)
}

// SetSetting writes the setting key.
func (s *Store) SetSetting(key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, string(b))
	return err
}

// SchemaVersion is the schema version this build writes.
func SchemaVersion() int { return len(migrations) }

func (s *Store) migrate() error { return s.migrateTo(len(migrations)) }

// migrateTo brings the schema up to version to (for tests: an older
// database).
func (s *Store) migrateTo(to int) error {
	var v int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return err
	}
	if v > len(migrations) {
		return fmt.Errorf("store: database schema version %d is newer than this aibo understands (%d)", v, len(migrations))
	}
	for ; v < to; v++ {
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(migrations[v]); err != nil {
			tx.Rollback()
			return fmt.Errorf("store: migration %d: %w", v+1, err)
		}
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, v+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func ms(t time.Time) int64 { return t.UnixMilli() }

func fromMS(v sql.NullInt64) time.Time {
	if !v.Valid {
		return time.Time{}
	}
	return time.UnixMilli(v.Int64)
}

// AddWorkspace stores a new workspace.
func (s *Store) AddWorkspace(w model.Workspace) error {
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM workspaces WHERE path = ?`, w.Path).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return ErrDuplicatePath
	}
	_, err := s.db.Exec(`INSERT INTO workspaces (id, path, created_at) VALUES (?, ?, ?)`, w.ID, w.Path, ms(w.CreatedAt))
	return err
}

// Workspaces returns every workspace, oldest first.
func (s *Store) Workspaces() ([]model.Workspace, error) {
	rows, err := s.db.Query(`SELECT id, path, created_at, removed FROM workspaces ORDER BY created_at, rowid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Workspace
	for rows.Next() {
		var w model.Workspace
		var at sql.NullInt64
		if err := rows.Scan(&w.ID, &w.Path, &at, &w.Removed); err != nil {
			return nil, err
		}
		w.CreatedAt = fromMS(at)
		out = append(out, w)
	}
	return out, rows.Err()
}

// CreateSession stores a new session, without native sessions or messages.
func (s *Store) CreateSession(x model.Session) error {
	_, err := s.db.Exec(`INSERT INTO sessions (id, workspace_id, agent, model, reasoning_effort, title, title_manual, created_at, active_at, approval_level, rules) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		x.ID, x.WorkspaceID, string(x.Agent), x.Model, x.Effort, x.Title, x.TitleManual, ms(x.CreatedAt), ms(x.ActiveAt), x.Mode, rulesValue(x.Rules))
	return err
}

// Sessions returns every session, most recently active first.
func (s *Store) Sessions() ([]model.Session, error) {
	rows, err := s.db.Query(`SELECT id, workspace_id, agent, model, reasoning_effort, title, title_manual, created_at, active_at, approval_level, rules, archived, read_dirs FROM sessions ORDER BY active_at DESC, rowid DESC`)
	if err != nil {
		return nil, err
	}
	var out []model.Session
	for rows.Next() {
		var x model.Session
		var kind string
		var rules, dirs sql.NullString
		var created, active sql.NullInt64
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &kind, &x.Model, &x.Effort, &x.Title, &x.TitleManual, &created, &active, &x.Mode, &rules, &x.Archived, &dirs); err != nil {
			rows.Close()
			return nil, err
		}
		x.Agent = agent.Kind(kind)
		if rules.Valid {
			json.Unmarshal([]byte(rules.String), &x.Rules)
		}
		if dirs.Valid {
			json.Unmarshal([]byte(dirs.String), &x.ReadDirs)
		}
		x.CreatedAt, x.ActiveAt = fromMS(created), fromMS(active)
		out = append(out, x)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		ids, err := s.nativeIDs(out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].NativeIDs = ids
	}
	return out, nil
}

func (s *Store) nativeIDs(sessionID string) ([]string, error) {
	rows, err := s.db.Query(`SELECT native_id FROM native_sessions WHERE session_id = ? ORDER BY idx`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// SetTitle sets a session's title; manual marks one the user chose.
func (s *Store) SetTitle(sessionID, title string, manual bool) error {
	_, err := s.db.Exec(`UPDATE sessions SET title = ?, title_manual = ? WHERE id = ?`, title, manual, sessionID)
	return err
}

// Touch records activity in a session at t.
func (s *Store) Touch(sessionID string, t time.Time) error {
	_, err := s.db.Exec(`UPDATE sessions SET active_at = ? WHERE id = ?`, ms(t), sessionID)
	return err
}

// AddNativeSession appends a native session to a session's history,
// making it the current one.
func (s *Store) AddNativeSession(sessionID, nativeID string, t time.Time) error {
	_, err := s.db.Exec(`INSERT INTO native_sessions (session_id, idx, native_id, started_at)
		VALUES (?, (SELECT count(*) FROM native_sessions WHERE session_id = ?), ?, ?)`, sessionID, sessionID, nativeID, ms(t))
	return err
}

// AppendMessage adds a message at the end of a session, giving it the
// session's next sequence number, which it returns.
func (s *Store) AppendMessage(sessionID string, m model.Message) (int, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var seq int
	if err := tx.QueryRow(`UPDATE sessions SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1`, sessionID).Scan(&seq); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, fmt.Errorf("store: no session %q", sessionID)
		}
		return 0, err
	}
	if _, err := tx.Exec(`INSERT INTO messages (session_id, seq, kind, state, text, thinking, raw, created_at, finished_at, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sessionID, seq, string(m.Kind), string(m.State), m.Text, m.Thinking, rawValue(m.Raw), ms(m.CreatedAt), finished(m), detailOf(m)); err != nil {
		return 0, err
	}
	return seq, tx.Commit()
}

// UpdateMessage replaces a streaming message's text, thinking, raw event
// and state. It fails with ErrMessageEnded once the stored message has
// ended.
func (s *Store) UpdateMessage(sessionID string, m model.Message) error {
	res, err := s.db.Exec(`UPDATE messages SET state = ?, text = ?, thinking = ?, raw = ?, finished_at = ?, detail = ? WHERE session_id = ? AND seq = ? AND state = ?`,
		string(m.State), m.Text, m.Thinking, rawValue(m.Raw), finished(m), detailOf(m), sessionID, m.Seq, string(model.Streaming))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrMessageEnded
	}
	return nil
}

// InterruptStreaming marks every message still streaming, left by a run
// that ended without finishing them, as interrupted at t.
func (s *Store) InterruptStreaming(t time.Time) error {
	_, err := s.db.Exec(`UPDATE messages SET state = ?, finished_at = ? WHERE state = ?`, string(model.Interrupted), ms(t), string(model.Streaming))
	return err
}

// Messages returns a session's messages in order, user messages with the
// references they delivered.
func (s *Store) Messages(sessionID string) ([]model.Message, error) {
	msgs, err := s.messages(sessionID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id, message_seq FROM session_refs WHERE target_id = ? AND state = ? ORDER BY message_seq, position`, sessionID, string(model.Delivered))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bySeq := map[int][]string{}
	for rows.Next() {
		var id string
		var seq int
		if err := rows.Scan(&id, &seq); err != nil {
			return nil, err
		}
		bySeq[seq] = append(bySeq[seq], id)
	}
	for i := range msgs {
		msgs[i].Refs = bySeq[msgs[i].Seq]
	}
	return msgs, rows.Err()
}

func (s *Store) messages(sessionID string) ([]model.Message, error) {
	rows, err := s.db.Query(`SELECT seq, kind, state, text, thinking, raw, created_at, finished_at, detail FROM messages WHERE session_id = ? ORDER BY seq`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Message
	for rows.Next() {
		var m model.Message
		var kind, state string
		var raw, det sql.NullString
		var created, fin sql.NullInt64
		if err := rows.Scan(&m.Seq, &kind, &state, &m.Text, &m.Thinking, &raw, &created, &fin, &det); err != nil {
			return nil, err
		}
		if det.Valid {
			var d detail
			if err := json.Unmarshal([]byte(det.String), &d); err != nil {
				return nil, fmt.Errorf("store: message #%d: %w", m.Seq, err)
			}
			m.Tool, m.Plan, m.Children, m.Mentions = d.Tool, d.Plan, d.Children, d.Mentions
		}
		m.Kind, m.State = model.MessageKind(kind), model.MessageState(state)
		if raw.Valid {
			m.Raw = json.RawMessage(raw.String)
		}
		m.CreatedAt, m.FinishedAt = fromMS(created), fromMS(fin)
		out = append(out, m)
	}
	return out, rows.Err()
}

func rawValue(r json.RawMessage) any {
	if len(r) == 0 {
		return nil
	}
	return string(r)
}

func finished(m model.Message) any {
	if !m.State.Ended() || m.FinishedAt.IsZero() {
		return nil
	}
	return ms(m.FinishedAt)
}

// DeleteSession deletes a session with its messages and the references
// it received. References to it stay, to report it deleted.
func (s *Store) DeleteSession(id string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE id = ?`, id)
	return err
}

// MessageRange returns a session's messages from..to, in order, and
// whether the session exists.
func (s *Store) MessageRange(sessionID string, from, to int) ([]model.Message, bool, error) {
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM sessions WHERE id = ?`, sessionID).Scan(&n); err != nil {
		return nil, false, err
	}
	if n == 0 {
		return nil, false, nil
	}
	all, err := s.messages(sessionID)
	if err != nil {
		return nil, true, err
	}
	var out []model.Message
	for _, m := range all {
		if m.Seq >= from && m.Seq <= to {
			out = append(out, m)
		}
	}
	return out, true, nil
}

// AddReference stores a new reference.
func (s *Store) AddReference(r model.Reference) error {
	_, err := s.db.Exec(`INSERT INTO session_refs (id, source_id, source_title, source_agent, source_workspace, from_seq, to_seq, count, target_id, brief, state, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.SourceID, r.SourceTitle, string(r.SourceAgent), r.SourceWorkspace, r.From, r.To, r.Count, r.TargetID, r.Brief, string(r.State), ms(r.CreatedAt))
	return err
}

// DeleteDraft deletes a reference that has not been delivered.
func (s *Store) DeleteDraft(id string) error {
	_, err := s.db.Exec(`DELETE FROM session_refs WHERE id = ? AND state = ?`, id, string(model.Draft))
	return err
}

// Deliver marks references, in order, as delivered by a user message.
func (s *Store) Deliver(ids []string, messageSeq int) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, id := range ids {
		if _, err := tx.Exec(`UPDATE session_refs SET state = ?, message_seq = ?, position = ? WHERE id = ?`, string(model.Delivered), messageSeq, i, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// AddRead records a read of a reference.
func (s *Store) AddRead(refID string, read model.ReferenceRead) error {
	_, err := s.db.Exec(`INSERT INTO ref_reads (ref_id, from_seq, to_seq, at) VALUES (?, ?, ?, ?)`, refID, read.From, read.To, ms(read.At))
	return err
}

// References returns every reference, with its reads, oldest first.
func (s *Store) References() ([]model.Reference, error) {
	rows, err := s.db.Query(`SELECT id, source_id, source_title, source_agent, source_workspace, from_seq, to_seq, count, target_id, brief, state, message_seq, created_at FROM session_refs ORDER BY created_at, rowid`)
	if err != nil {
		return nil, err
	}
	var out []model.Reference
	index := map[string]int{}
	for rows.Next() {
		var r model.Reference
		var agentKind, state string
		var msgSeq sql.NullInt64
		var created sql.NullInt64
		if err := rows.Scan(&r.ID, &r.SourceID, &r.SourceTitle, &agentKind, &r.SourceWorkspace, &r.From, &r.To, &r.Count, &r.TargetID, &r.Brief, &state, &msgSeq, &created); err != nil {
			rows.Close()
			return nil, err
		}
		r.SourceAgent, r.State = agent.Kind(agentKind), model.ReferenceState(state)
		r.MessageSeq, r.CreatedAt = int(msgSeq.Int64), fromMS(created)
		index[r.ID] = len(out)
		out = append(out, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	reads, err := s.db.Query(`SELECT ref_id, from_seq, to_seq, at FROM ref_reads ORDER BY at, rowid`)
	if err != nil {
		return nil, err
	}
	defer reads.Close()
	for reads.Next() {
		var id string
		var rd model.ReferenceRead
		var at sql.NullInt64
		if err := reads.Scan(&id, &rd.From, &rd.To, &at); err != nil {
			return nil, err
		}
		rd.At = fromMS(at)
		if i, ok := index[id]; ok {
			out[i].Reads = append(out[i].Reads, rd)
		}
	}
	return out, reads.Err()
}

// detail is what the detail column holds.
type detail struct {
	Tool     *model.Tool      `json:"tool,omitempty"`
	Plan     []agent.PlanItem `json:"plan,omitempty"`
	Children []model.Message  `json:"children,omitempty"`
	Mentions []model.Mention  `json:"mentions,omitempty"`
}

func detailOf(m model.Message) any {
	if m.Tool == nil && m.Plan == nil && m.Children == nil && m.Mentions == nil {
		return nil
	}
	b, err := json.Marshal(detail{Tool: m.Tool, Plan: m.Plan, Children: m.Children, Mentions: m.Mentions})
	if err != nil {
		return nil
	}
	return string(b)
}

// SetApproval sets a session's permission mode and rules.
func (s *Store) SetApproval(sessionID string, mode string, rules []agent.Rule) error {
	_, err := s.db.Exec(`UPDATE sessions SET approval_level = ?, rules = ? WHERE id = ?`, mode, rulesValue(rules), sessionID)
	return err
}

func rulesValue(rules []agent.Rule) any {
	if len(rules) == 0 {
		return nil
	}
	b, err := json.Marshal(rules)
	if err != nil {
		return nil
	}
	return string(b)
}

// AddMarker adds a marker to a session.
func (s *Store) AddMarker(sessionID string, m model.Marker) error {
	_, err := s.db.Exec(`INSERT INTO markers (session_id, after_seq, kind, trigger, pre_tokens, post_tokens, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		sessionID, m.AfterSeq, string(m.Kind), m.Trigger, m.PreTokens, m.PostTokens, ms(m.At))
	return err
}

// Markers returns a session's markers in order.
func (s *Store) Markers(sessionID string) ([]model.Marker, error) {
	rows, err := s.db.Query(`SELECT after_seq, kind, trigger, pre_tokens, post_tokens, at FROM markers WHERE session_id = ? ORDER BY after_seq, rowid`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Marker
	for rows.Next() {
		var m model.Marker
		var kind string
		var at sql.NullInt64
		if err := rows.Scan(&m.AfterSeq, &kind, &m.Trigger, &m.PreTokens, &m.PostTokens, &at); err != nil {
			return nil, err
		}
		m.Kind, m.At = model.MarkerKind(kind), fromMS(at)
		out = append(out, m)
	}
	return out, rows.Err()
}

// SetWorkspace sets a workspace's path and whether it is removed.
func (s *Store) SetWorkspace(w model.Workspace) error {
	_, err := s.db.Exec(`UPDATE workspaces SET path = ?, removed = ? WHERE id = ?`, w.Path, w.Removed, w.ID)
	return err
}

// SetArchived archives a session, or brings it back.
func (s *Store) SetArchived(sessionID string, archived bool) error {
	_, err := s.db.Exec(`UPDATE sessions SET archived = ? WHERE id = ?`, archived, sessionID)
	return err
}

// ArchiveWorkspace archives every session of a workspace.
func (s *Store) ArchiveWorkspace(workspaceID string) error {
	_, err := s.db.Exec(`UPDATE sessions SET archived = 1 WHERE workspace_id = ?`, workspaceID)
	return err
}

// SearchMessages returns the sessions with messages containing text (in
// any case, for Latin letters), with the first such message's text.
func (s *Store) SearchMessages(text string) (map[string]string, error) {
	rows, err := s.db.Query(`SELECT session_id, text FROM messages WHERE instr(lower(text), lower(?)) > 0 ORDER BY session_id, seq`, text)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, t string
		if err := rows.Scan(&id, &t); err != nil {
			return nil, err
		}
		if _, ok := out[id]; !ok {
			out[id] = t
		}
	}
	return out, rows.Err()
}

// SetReadDirs sets the other workspaces a session may read.
// SetModel sets a session's model and reasoning effort.
func (s *Store) SetModel(sessionID, model, effort string) error {
	_, err := s.db.Exec(`UPDATE sessions SET model = ?, reasoning_effort = ? WHERE id = ?`, model, effort, sessionID)
	return err
}

func (s *Store) SetReadDirs(sessionID string, dirs []string) error {
	b, err := json.Marshal(dirs)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE sessions SET read_dirs = ? WHERE id = ?`, string(b), sessionID)
	return err
}
