// Package workbench is the workbench's core: workspaces, sessions, and
// the runtime that sends turns to Agents and records what they report.
// The shell UI only calls the operations here, and tests drive the same
// operations with the scripted fake Agent.
package workbench

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/mcpserver"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/refs"
	"github.com/chldu2000/aibo/internal/store"
)

// Options configures Open.
type Options struct {
	// DataDir holds the database.
	DataDir string
	// Agents are the Agents sessions can use.
	Agents []agent.Agent
	// Now tells the time; nil uses time.Now.
	Now func() time.Time
	// Budgets are the read tools' page sizes; zero uses the defaults.
	Budgets refs.Budgets
	// IdleTimeout is how long a native session runs without a turn
	// before it is stopped (30 minutes when zero); IdleCheck is how often
	// that is looked at (a minute when zero).
	IdleTimeout time.Duration
	IdleCheck   time.Duration
	// Ready, when set, says why a message cannot go to an Agent now (not
	// installed, signed out): the message is not sent.
	Ready func(agent.Kind) error
	// OnNotLoggedIn, when set, is told when a session finds its Agent
	// signed out.
	OnNotLoggedIn func(agent.Kind)
}

// Errors of the workbench's operations.
var (
	ErrNotDirectory     = errors.New("不是一个文件夹")
	ErrWorkspaceExists  = errors.New("这个文件夹已经是工作区了")
	ErrNoSuchWorkspace  = errors.New("工作区不存在")
	ErrNoSuchSession    = errors.New("会话不存在")
	ErrUnknownAgent     = errors.New("没有这个 Agent")
	ErrTurnRunning      = errors.New("Agent 正在回复，请先停止或等它完成")
	ErrEmptyMessage     = errors.New("消息不能为空")
	ErrNothingToRef     = errors.New("会话里还没有可以引用的消息")
	ErrSlashCommand     = errors.New("暂不支持 Agent 自带的斜杠命令。要压缩上下文，请用输入框里的“压缩上下文”")
	ErrNothingToCompact = errors.New("会话里还没有内容，无需压缩")
	ErrNeedsRecovery    = errors.New("原生会话无法续接：请先选择新开原生会话，或暂不处理")
	ErrNoSuchReference  = errors.New("引用不存在")
	ErrBadRange         = errors.New("引用范围无效")
	ErrNoSuchApproval   = errors.New("这个审批请求已经处理过或不存在")
	ErrNoSuchLevel      = errors.New("没有这个审批档位")
	ErrNoSuchRule       = errors.New("没有这条规则")
	errWorkbenchClosing = errors.New("工作台正在关闭")
)

// Change tells listeners that something changed. Message, when set, is
// the new state of one message of SessionID, which a listener can apply
// without reloading the session; otherwise the session's (or, with an
// empty SessionID, the workbench's) state should be read again.
type Change struct {
	SessionID string
	Message   *model.Message
}

// Status is a session's runtime state, which is not persisted.
type Status struct {
	// Connected is set while the session has a native session running.
	Connected bool
	// Running is set while a turn is running.
	Running bool
	// Error is the last error the Agent reported, until the next turn.
	Error string
	// Approvals counts the approval requests waiting for an answer.
	Approvals int
	// ResumeFailed is the Agent's error when the native session could
	// not be resumed, until the user chooses what to do (Recover).
	// ReadOnly is set when the user chose to leave it for now.
	ResumeFailed string
	ReadOnly     bool
	// NeedsLogin is set when the last turn found the Agent signed out.
	NeedsLogin bool
	// Since is when the running turn started.
	Since time.Time
	// Retrying, while the turn runs, says why the Agent is trying again
	// to reach its model (agent.Retrying), until it gets on.
	Retrying string
	// Model and Effort are what the Agent last said it uses
	// (agent.SettingsReported); empty until it says.
	Model, Effort string
}

// AgentInfo describes an available Agent.
type AgentInfo struct {
	Kind agent.Kind
	Name string
}

// Workbench is the open workbench.
type Workbench struct {
	st        *store.Store
	mcp       *mcpserver.Server
	agents    []agent.Agent
	now       func() time.Time
	budgets   refs.Budgets
	idle      time.Duration
	settings  Settings
	ready     func(agent.Kind) error
	loggedOut func(agent.Kind)
	done      chan struct{} // closed when the workbench closes
	pumps     sync.WaitGroup

	mu         sync.Mutex
	closing    bool
	workspaces []model.Workspace
	sessions   map[string]*session
	refs       map[string]*model.Reference
	listeners  map[int]func(Change)
	nextL      int
}

// session is a session's state in memory.
type session struct {
	info    model.Session
	msgs    []model.Message // nil until loaded
	markers []model.Marker  // loaded with msgs
	loaded  bool

	native  agent.Session // nil while not connected
	running bool
	err     string
	// items maps the running turn's replies, tool calls and plans, by
	// the keys of itemKey, to indexes in msgs.
	items     map[string]int
	lastFlush time.Time
	// resumeFailed is the Agent's error when the native session could not
	// be resumed, until the user chooses what to do (Recover); readOnly
	// is set when the user chose to leave it for now.
	resumeFailed string
	readOnly     bool
	// needsLogin is set when the last turn found the Agent signed out.
	needsLogin bool
	// since is when the running turn started; retrying is the Agent's
	// last agent.Retrying, until anything else happens.
	since    time.Time
	retrying string
	// reported is the model and the effort the Agent last said it uses.
	reported agent.SettingsReported
	// lastActive is when the session last did something, for idle
	// disconnection.
	lastActive time.Time
	// restart is set when the native session must start again, without
	// a revoked rule, once its turn ends.
	restart bool
	// loose are approval requests whose tool call has not started, by
	// the tool call's ID, in the order they came.
	loose []looseApproval
}

// flushEvery is how often a streaming message's text is written to the
// database, so that a crash loses at most this much of it.
const flushEvery = 500 * time.Millisecond

// Open opens the workbench on the data directory.
func Open(o Options) (*Workbench, error) {
	if o.Now == nil {
		o.Now = time.Now
	}

	st, err := store.Open(o.DataDir)
	if err != nil {
		return nil, err
	}
	// Messages a previous run left streaming were cut off by it.
	if err := st.InterruptStreaming(o.Now()); err != nil {
		st.Close()
		return nil, err
	}
	// The user's settings, unless the options say otherwise (tests).
	settings := DefaultSettings
	if _, err := st.Setting(settingsKey, &settings); err != nil {
		st.Close()
		return nil, err
	}
	if o.Budgets != (refs.Budgets{}) {
		settings.Budgets = o.Budgets
	}
	if o.IdleTimeout != 0 {
		settings.IdleTimeout = o.IdleTimeout
	}
	if o.IdleCheck == 0 {
		o.IdleCheck = time.Minute
	}
	w := &Workbench{st: st, agents: o.Agents, now: o.Now, budgets: settings.Budgets, idle: settings.IdleTimeout, settings: settings, ready: o.Ready, loggedOut: o.OnNotLoggedIn, done: make(chan struct{}), sessions: map[string]*session{}, refs: map[string]*model.Reference{}, listeners: map[int]func(Change){}}
	if w.workspaces, err = st.Workspaces(); err != nil {
		st.Close()
		return nil, err
	}
	all, err := st.Sessions()
	if err != nil {
		st.Close()
		return nil, err
	}
	for _, x := range all {
		w.sessions[x.ID] = &session{info: x}
	}
	refs, err := st.References()
	if err != nil {
		st.Close()
		return nil, err
	}
	for i := range refs {
		w.refs[refs[i].ID] = &refs[i]
	}
	if w.mcp, err = mcpserver.Start(reader{w}); err != nil {
		st.Close()
		return nil, err
	}
	w.checkWorkspaces()
	go w.watchIdle(o.IdleCheck)
	return w, nil
}

// Close ends every native session, marking turns still running as
// interrupted, and closes the database.
func (w *Workbench) Close() error {
	w.mu.Lock()
	if w.closing {
		w.mu.Unlock()
		return nil
	}
	w.closing = true
	close(w.done)
	var natives []agent.Session
	for _, s := range w.sessions {
		if s.native != nil {
			natives = append(natives, s.native)
		}
	}
	w.mu.Unlock()
	for _, n := range natives {
		n.Close()
	}
	w.pumps.Wait()
	w.mcp.Close()
	return w.st.Close()
}

// Subscribe calls fn after every change, from any goroutine, until the
// returned function is called. fn must not block.
func (w *Workbench) Subscribe(fn func(Change)) (unsubscribe func()) {
	w.mu.Lock()
	defer w.mu.Unlock()
	id := w.nextL
	w.nextL++
	w.listeners[id] = fn
	return func() {
		w.mu.Lock()
		delete(w.listeners, id)
		w.mu.Unlock()
	}
}

func (w *Workbench) notify(c Change) {
	w.mu.Lock()
	fns := make([]func(Change), 0, len(w.listeners))
	for _, fn := range w.listeners {
		fns = append(fns, fn)
	}
	w.mu.Unlock()
	for _, fn := range fns {
		fn(c)
	}
}

// Agents lists the Agents new sessions can use.
func (w *Workbench) Agents() []AgentInfo {
	out := make([]AgentInfo, len(w.agents))
	for i, a := range w.agents {
		out[i] = AgentInfo{Kind: a.Kind(), Name: a.Name()}
	}
	return out
}

func (w *Workbench) agent(kind agent.Kind) agent.Agent {
	for _, a := range w.agents {
		if a.Kind() == kind {
			return a
		}
	}
	return nil
}

// AddWorkspace adds the directory at path as a workspace, identified by
// its absolute path.
func (w *Workbench) AddWorkspace(path string) (model.Workspace, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return model.Workspace{}, err
	}
	if fi, err := os.Stat(abs); err != nil || !fi.IsDir() {
		return model.Workspace{}, fmt.Errorf("%s：%w", abs, ErrNotDirectory)
	}
	ws := model.Workspace{ID: newID("w_"), Path: abs, CreatedAt: w.now()}
	w.mu.Lock()
	for i, old := range w.workspaces {
		if old.Path == abs && old.Removed {
			// Added again: it comes back, its sessions still archived.
			old.Removed = false
			if err := w.st.SetWorkspace(old); err != nil {
				w.mu.Unlock()
				return model.Workspace{}, err
			}
			w.workspaces[i] = old
			w.mu.Unlock()
			w.notify(Change{})
			return old, nil
		}
	}
	err = w.st.AddWorkspace(ws)
	if err == nil {
		w.workspaces = append(w.workspaces, ws)
	}
	w.mu.Unlock()
	if errors.Is(err, store.ErrDuplicatePath) {
		return model.Workspace{}, fmt.Errorf("%s：%w", abs, ErrWorkspaceExists)
	}
	if err != nil {
		return model.Workspace{}, err
	}
	w.notify(Change{})
	return ws, nil
}

// Workspaces returns the workspaces in the order they were added.
func (w *Workbench) Workspaces() []model.Workspace {
	w.mu.Lock()
	defer w.mu.Unlock()
	var out []model.Workspace
	for _, ws := range w.workspaces {
		if !ws.Removed {
			out = append(out, ws)
		}
	}
	return out
}

func (w *Workbench) workspace(id string) (model.Workspace, bool) {
	for _, ws := range w.workspaces {
		if ws.ID == id {
			return ws, true
		}
	}
	return model.Workspace{}, false
}

// NewSession creates a session in a workspace with one Agent. No Agent
// process starts until its first message is sent.
func (w *Workbench) NewSession(workspaceID string, kind agent.Kind, modelName string) (model.Session, error) {
	if w.agent(kind) == nil {
		return model.Session{}, fmt.Errorf("%s：%w", kind, ErrUnknownAgent)
	}
	now := w.now()
	x := model.Session{ID: newID("s_"), WorkspaceID: workspaceID, Agent: kind, Model: modelName, CreatedAt: now, ActiveAt: now}
	w.mu.Lock()
	x.Level = w.settings.DefaultLevel
	if _, ok := w.workspace(workspaceID); !ok {
		w.mu.Unlock()
		return model.Session{}, ErrNoSuchWorkspace
	}
	err := w.st.CreateSession(x)
	if err == nil {
		w.sessions[x.ID] = &session{info: x, loaded: true}
	}
	w.mu.Unlock()
	if err != nil {
		return model.Session{}, err
	}
	w.notify(Change{SessionID: x.ID})
	return x, nil
}

// Sessions returns every session, most recently active first.
func (w *Workbench) Sessions() []model.Session {
	w.mu.Lock()
	out := make([]model.Session, 0, len(w.sessions))
	for _, s := range w.sessions {
		out = append(out, s.info)
	}
	w.mu.Unlock()
	sort.Slice(out, func(i, j int) bool {
		if !out[i].ActiveAt.Equal(out[j].ActiveAt) {
			return out[i].ActiveAt.After(out[j].ActiveAt)
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out
}

// Session returns one session.
func (w *Workbench) Session(id string) (model.Session, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	s, ok := w.sessions[id]
	if !ok {
		return model.Session{}, false
	}
	return s.info, true
}

// Status returns a session's runtime state.
func (w *Workbench) Status(id string) Status {
	w.mu.Lock()
	defer w.mu.Unlock()
	s, ok := w.sessions[id]
	if !ok {
		return Status{}
	}
	return Status{Connected: s.native != nil, Running: s.running, Error: s.err, Approvals: len(w.pending(s)),
		ResumeFailed: s.resumeFailed, ReadOnly: s.readOnly, NeedsLogin: s.needsLogin, Since: s.since, Retrying: s.retrying,
		Model: s.reported.Model, Effort: s.reported.Effort}
}

// Messages returns a session's messages in order.
func (w *Workbench) Messages(id string) ([]model.Message, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	s, ok := w.sessions[id]
	if !ok {
		return nil, ErrNoSuchSession
	}
	if err := w.load(id, s); err != nil {
		return nil, err
	}
	out := make([]model.Message, len(s.msgs))
	for i, m := range s.msgs {
		out[i] = m.Clone()
	}
	return out, nil
}

// load reads a session's messages once. w.mu is held.
func (w *Workbench) load(id string, s *session) error {
	if s.loaded {
		return nil
	}
	msgs, err := w.st.Messages(id)
	if err != nil {
		return err
	}
	markers, err := w.st.Markers(id)
	if err != nil {
		return err
	}
	s.msgs, s.markers, s.loaded = msgs, markers, true
	return nil
}

// Send sends the user's message to the session's Agent, starting or
// resuming its native session first if none is running.
//
// The session's draft references are delivered with the message: their
// blocks precede its text in what the Agent receives, and the message
// may then have no text of its own.
func (w *Workbench) Send(id, text string) error {
	text = strings.TrimSpace(text)

	w.mu.Lock()
	s, ok := w.sessions[id]
	switch {
	case !ok:
		w.mu.Unlock()
		return ErrNoSuchSession
	case w.closing:
		w.mu.Unlock()
		return errWorkbenchClosing
	case s.resumeFailed != "":
		w.mu.Unlock()
		return ErrNeedsRecovery
	}
	if slashCommand.MatchString(text) {
		// aibo's record would no longer match the Agent's state.
		w.mu.Unlock()
		return ErrSlashCommand
	}
	if text == "" && len(w.drafts(id)) == 0 {
		w.mu.Unlock()
		return ErrEmptyMessage
	}
	if s.running {
		w.mu.Unlock()
		return ErrTurnRunning
	}
	if w.ready != nil {
		if err := w.ready(s.info.Agent); err != nil {
			w.mu.Unlock()
			return err
		}
	}
	if ws, _ := w.workspace(s.info.WorkspaceID); ws.Missing {
		w.mu.Unlock()
		return ErrWorkspaceMissing
	}
	if err := w.load(id, s); err != nil {
		w.mu.Unlock()
		return err
	}
	// Running from here, so that nothing else starts meanwhile.
	s.running, s.err, s.items, s.needsLogin = true, "", map[string]int{}, false
	s.since, s.retrying = w.now(), ""
	ws, _ := w.workspace(s.info.WorkspaceID)
	var stop agent.Session
	if w.readDirs(id, s, ws) && s.native != nil && w.dirsAtStart(s.info.Agent) {
		// The Agent reads other workspaces only from its start.
		stop = w.detach(id, s)
	}
	native, info := s.native, s.info
	w.mu.Unlock()
	if stop != nil {
		stop.Close()
	}

	// The native session first: if it cannot be resumed, nothing is
	// recorded, and the user's words stay in the composer.
	if native == nil {
		var err error
		if native, err = w.connect(id, info, ws); err != nil {
			w.startFailed(id, err)
			return err
		}
	}

	now := w.now()
	w.mu.Lock()
	drafts := w.drafts(id)
	m := model.Message{Kind: model.UserMessage, State: model.Done, Text: text, CreatedAt: now, FinishedAt: now}
	seq, err := w.st.AppendMessage(id, m)
	if err != nil {
		s.running = false
		w.mu.Unlock()
		return err
	}
	m.Seq = seq
	var briefs []string
	for _, r := range drafts {
		m.Refs = append(m.Refs, r.ID)
		briefs = append(briefs, r.Brief)
	}
	if len(drafts) > 0 {
		if err := w.st.Deliver(m.Refs, seq); err != nil {
			s.running = false
			w.mu.Unlock()
			return err
		}
		for _, r := range drafts {
			r.State, r.MessageSeq = model.Delivered, seq
		}
	}
	s.msgs = append(s.msgs, m)
	if s.info.Title == "" && !s.info.TitleManual && text != "" {
		s.info.Title = defaultTitle(text)
		w.st.SetTitle(id, s.info.Title, false)
	}
	s.info.ActiveAt, s.lastActive = now, now
	w.st.Touch(id, now)
	w.mu.Unlock()
	w.notify(Change{SessionID: id, Message: &m})

	if err := native.Send(context.Background(), agent.Turn{Text: refs.TurnText(briefs, text)}); err != nil {
		w.fail(id, "发送失败："+err.Error())
		return err
	}
	return nil
}

// startFailed ends a turn whose native session did not start: a native
// session that cannot be resumed waits for the user to choose what to do
// (Recover).
func (w *Workbench) startFailed(id string, err error) {
	if !errors.Is(err, agent.ErrResumeFailed) {
		w.fail(id, "启动 Agent 失败："+err.Error())
		return
	}
	w.mu.Lock()
	if s, ok := w.sessions[id]; ok {
		s.running, s.resumeFailed, s.readOnly = false, err.Error(), false
	}
	w.mu.Unlock()
	w.notify(Change{SessionID: id})
}

// connect starts or resumes the session's native session and pumps its
// events.
func (w *Workbench) connect(id string, info model.Session, ws model.Workspace) (agent.Session, error) {
	a := w.agent(info.Agent)
	if a == nil {
		return nil, fmt.Errorf("%s：%w", info.Agent, ErrUnknownAgent)
	}
	mcp := &agent.MCPServer{URL: w.mcp.URL(), Token: w.mcp.Issue(id)}
	native, err := a.Start(context.Background(), agent.StartOptions{Workspace: ws.Path, Model: info.Model, Effort: info.Effort, ResumeID: info.NativeID(), MCP: mcp,
		Level: info.Level, Rules: info.Rules, ReadDirs: info.ReadDirs})
	if err != nil {
		w.mcp.Revoke(id)
		return nil, err
	}
	w.mu.Lock()
	if w.closing {
		w.mu.Unlock()
		native.Close()
		return nil, errWorkbenchClosing
	}
	w.sessions[id].native = native
	w.sessions[id].lastActive = w.now()
	w.pumps.Add(1)
	w.mu.Unlock()
	go w.pump(id, native)
	return native, nil
}

// fail ends a turn that could not start.
func (w *Workbench) fail(id, msg string) {
	w.mu.Lock()
	if s, ok := w.sessions[id]; ok {
		s.running, s.err = false, msg
	}
	w.mu.Unlock()
	w.notify(Change{SessionID: id})
}

// Stop interrupts the session's running turn.
func (w *Workbench) Stop(id string) error {
	w.mu.Lock()
	s, ok := w.sessions[id]
	if !ok {
		w.mu.Unlock()
		return ErrNoSuchSession
	}
	native := s.native
	w.mu.Unlock()
	if native == nil {
		return nil
	}
	return native.Interrupt(context.Background())
}

// pump records a native session's events until it ends.
func (w *Workbench) pump(id string, native agent.Session) {
	defer w.pumps.Done()
	for ev := range native.Events() {
		w.handle(id, native, ev)
	}
	w.mu.Lock()
	s := w.sessions[id]
	if s == nil || s.native != native {
		// Deleted, or let go (detach): another native session may be
		// running a turn of its own now.
		w.mu.Unlock()
		return
	}
	s.native = nil
	w.mcp.Revoke(id)
	changed := w.endTurn(id, s, model.Interrupted)
	w.mu.Unlock()
	for _, m := range changed {
		w.notify(Change{SessionID: id, Message: &m})
	}
	w.notify(Change{SessionID: id})
}

// slashCommand is an Agent's own slash command, as /clear or
// /model sonnet: a word after the slash, not a path.
var slashCommand = regexp.MustCompile(`^/[A-Za-z][\w:-]*(\s|$)`)

// Markers returns a session's markers in order.
func (w *Workbench) Markers(id string) []model.Marker {
	w.mu.Lock()
	defer w.mu.Unlock()
	s, ok := w.sessions[id]
	if !ok || w.load(id, s) != nil {
		return nil
	}
	return append([]model.Marker(nil), s.markers...)
}

// addMarker marks something after the session's last message. w.mu is
// held.
func (w *Workbench) addMarker(id string, s *session, m model.Marker) {
	if len(s.msgs) > 0 {
		m.AfterSeq = s.msgs[len(s.msgs)-1].Seq
	}
	if err := w.st.AddMarker(id, m); err != nil {
		s.err = "保存标记失败：" + err.Error()
		return
	}
	s.markers = append(s.markers, m)
}

// Compact asks the session's Agent to compact its context, as a turn of
// its own, starting or resuming its native session first if none runs.
func (w *Workbench) Compact(id string) error {
	w.mu.Lock()
	s, ok := w.sessions[id]
	switch {
	case !ok:
		w.mu.Unlock()
		return ErrNoSuchSession
	case w.closing:
		w.mu.Unlock()
		return errWorkbenchClosing
	case s.running:
		w.mu.Unlock()
		return ErrTurnRunning
	case s.resumeFailed != "":
		w.mu.Unlock()
		return ErrNeedsRecovery
	}
	if w.ready != nil {
		if err := w.ready(s.info.Agent); err != nil {
			w.mu.Unlock()
			return err
		}
	}
	if ws, _ := w.workspace(s.info.WorkspaceID); ws.Missing {
		w.mu.Unlock()
		return ErrWorkspaceMissing
	}
	if err := w.load(id, s); err != nil {
		w.mu.Unlock()
		return err
	}
	if len(s.msgs) == 0 {
		w.mu.Unlock()
		return ErrNothingToCompact
	}
	s.running, s.err, s.items = true, "", map[string]int{}
	native, info := s.native, s.info
	ws, _ := w.workspace(info.WorkspaceID)
	w.mu.Unlock()
	w.notify(Change{SessionID: id})
	if native == nil {
		var err error
		if native, err = w.connect(id, info, ws); err != nil {
			w.startFailed(id, err)
			return err
		}
	}
	if err := native.Compact(context.Background()); err != nil {
		w.fail(id, "压缩失败："+err.Error())
		return err
	}
	return nil
}

// titleLen is how many characters of the first user message make the
// default title.
const titleLen = 40

// defaultTitle is the start of the first line of a session's first user
// message.
func defaultTitle(text string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(text), "\n")
	line = strings.TrimSpace(line)
	if utf8.RuneCountInString(line) <= titleLen {
		return line
	}
	r := []rune(line)
	return strings.TrimSpace(string(r[:titleLen])) + "…"
}

const idChars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

// newID returns prefix followed by 12 random base-62 characters.
func newID(prefix string) string {
	b := make([]byte, 12)
	rand.Read(b)
	for i := range b {
		b[i] = idChars[int(b[i])%len(idChars)]
	}
	return prefix + string(b)
}
