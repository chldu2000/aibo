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
}

// SchemaVersion is the schema version this build writes.
func SchemaVersion() int { return len(migrations) }

func (s *Store) migrate() error {
	var v int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return err
	}
	if v > len(migrations) {
		return fmt.Errorf("store: database schema version %d is newer than this aibo understands (%d)", v, len(migrations))
	}
	for ; v < len(migrations); v++ {
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
	rows, err := s.db.Query(`SELECT id, path, created_at FROM workspaces ORDER BY created_at, rowid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Workspace
	for rows.Next() {
		var w model.Workspace
		var at sql.NullInt64
		if err := rows.Scan(&w.ID, &w.Path, &at); err != nil {
			return nil, err
		}
		w.CreatedAt = fromMS(at)
		out = append(out, w)
	}
	return out, rows.Err()
}

// CreateSession stores a new session, without native sessions or messages.
func (s *Store) CreateSession(x model.Session) error {
	level := x.Level
	if level == "" {
		level = agent.AskAlways
	}
	_, err := s.db.Exec(`INSERT INTO sessions (id, workspace_id, agent, model, title, title_manual, created_at, active_at, approval_level, rules) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		x.ID, x.WorkspaceID, string(x.Agent), x.Model, x.Title, x.TitleManual, ms(x.CreatedAt), ms(x.ActiveAt), string(level), rulesValue(x.Rules))
	return err
}

// Sessions returns every session, most recently active first.
func (s *Store) Sessions() ([]model.Session, error) {
	rows, err := s.db.Query(`SELECT id, workspace_id, agent, model, title, title_manual, created_at, active_at, approval_level, rules FROM sessions ORDER BY active_at DESC, rowid DESC`)
	if err != nil {
		return nil, err
	}
	var out []model.Session
	for rows.Next() {
		var x model.Session
		var kind, level string
		var rules sql.NullString
		var created, active sql.NullInt64
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &kind, &x.Model, &x.Title, &x.TitleManual, &created, &active, &level, &rules); err != nil {
			rows.Close()
			return nil, err
		}
		x.Agent, x.Level = agent.Kind(kind), agent.ApprovalLevel(level)
		if rules.Valid {
			json.Unmarshal([]byte(rules.String), &x.Rules)
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
			m.Tool, m.Plan, m.Children = d.Tool, d.Plan, d.Children
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
}

func detailOf(m model.Message) any {
	if m.Tool == nil && m.Plan == nil && m.Children == nil {
		return nil
	}
	b, err := json.Marshal(detail{Tool: m.Tool, Plan: m.Plan, Children: m.Children})
	if err != nil {
		return nil
	}
	return string(b)
}

// SetApproval sets a session's approval level and rules.
func (s *Store) SetApproval(sessionID string, level agent.ApprovalLevel, rules []agent.Rule) error {
	_, err := s.db.Exec(`UPDATE sessions SET approval_level = ?, rules = ? WHERE id = ?`, string(level), rulesValue(rules), sessionID)
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
