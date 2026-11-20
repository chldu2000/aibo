// Package shell is the workbench's window: a floating Liquid Glass
// sidebar of workspaces and their sessions, and the session pane with its
// messages and composer. It only calls the workbench core's operations,
// and learns of changes through Workbench.Subscribe.
package shell

import (
	"errors"
	"path/filepath"
	"sync"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
)

// Options configures a Shell.
type Options struct {
	// Wake asks for a frame after the workbench changed, from any
	// goroutine (mygo.Window.Invalidate).
	Wake func()
	// Notify, when set, shows a desktop notification about a session:
	// MyGo's, which the app wires to open the session when clicked
	// (Shell.Open).
	Notify func(sessionID, title, body string)
	// ChooseFolder asks the user for a folder to add as a workspace,
	// blocking until they choose; ok is false when they cancel. It runs
	// off the main thread.
	ChooseFolder func() (path string, ok bool)
}

// Shell is the window's state.
type Shell struct {
	wb   *workbench.Workbench
	opts Options

	mu       sync.Mutex
	pending  []workbench.Change // changes not yet applied
	laterFns []func()           // to run on the main thread

	// Owned by the main thread, where View runs:
	current string
	split   float32
	views   map[string]*sessionView
	notice  string // an error to show, until dismissed
	md      markdown.Options
	// pull is the @ panel of the open session.
	pull pull
	// choosingAgent is the workspace whose "+" shows the Agents to start
	// a session with.
	choosingAgent string
	// refocus gives the composer the keyboard focus in the next frame
	// that builds it.
	refocus bool
	// level is the approval control's popover.
	level levelState
	// seen counts each session's approval requests last seen, to notify
	// of new ones.
	seen map[string]int
	// approvals are the approval cards' states, by request ID.
	approvals map[string]*approvalUI
	// openCards are the reference cards showing their briefs.
	openCards map[string]bool
}

// sessionView is what the shell keeps of an open session.
type sessionView struct {
	msgs   []model.Message
	loaded bool
	list   ui.ListState
	draft  string
	// typed is the draft as the composer last saw it, to notice an "@"
	// typed into it.
	typed string
	// sel is selection mode.
	sel selection
	// open is which disclosures of the messages are open.
	open open
	// highlight is the range of sequence numbers shown highlighted, as
	// when jumping to what a reference covers; zero for none.
	highlight [2]int
}

// New returns the shell of wb.
func New(wb *workbench.Workbench, o Options) *Shell {
	if o.Wake == nil {
		o.Wake = func() {}
	}
	s := &Shell{wb: wb, opts: o, split: 260, views: map[string]*sessionView{}, openCards: map[string]bool{}}
	wb.Subscribe(func(c workbench.Change) {
		s.mu.Lock()
		s.pending = append(s.pending, c)
		s.mu.Unlock()
		o.Wake()
	})
	if all := wb.Sessions(); len(all) > 0 {
		s.current = all[0].ID
	}
	return s
}

// apply applies the changes the workbench reported since the last frame.
func (s *Shell) apply() {
	s.mu.Lock()
	pending, fns := s.pending, s.laterFns
	s.pending, s.laterFns = nil, nil
	s.mu.Unlock()
	for _, fn := range fns {
		fn()
	}
	for _, c := range pending {
		if v, ok := s.views[c.SessionID]; ok && v.loaded && c.Message != nil {
			v.upsert(*c.Message)
		}
	}
	s.notifyApprovals(pending)
}

// upsert puts m in place of the message with its Seq, or at the end.
func (v *sessionView) upsert(m model.Message) {
	for i := len(v.msgs) - 1; i >= 0; i-- {
		if v.msgs[i].Seq == m.Seq {
			v.msgs[i] = m
			return
		}
		if v.msgs[i].Seq < m.Seq {
			break
		}
	}
	v.msgs = append(v.msgs, m)
}

// view returns the open session's view, loading its messages once.
func (s *Shell) view(id string) *sessionView {
	v, ok := s.views[id]
	if !ok {
		v = &sessionView{}
		v.list.Key = func(i int) any { return v.msgs[i].Seq }
		v.list.FollowEnd = true
		v.list.FollowAnimation = &ui.Smooth
		s.views[id] = v
	}
	if !v.loaded {
		msgs, err := s.wb.Messages(id)
		if err != nil {
			s.notice = err.Error()
			return v
		}
		v.msgs, v.loaded = msgs, true
	}
	return v
}

// addWorkspace asks for a folder and adds it.
func (s *Shell) addWorkspace() {
	if s.opts.ChooseFolder == nil {
		return
	}
	go func() {
		path, ok := s.opts.ChooseFolder()
		if !ok {
			return
		}
		if _, err := s.wb.AddWorkspace(path); err != nil {
			s.later(func() { s.notice = "添加工作区失败：" + err.Error() })
		}
	}()
}

// later runs fn on the main thread before the next frame.
func (s *Shell) later(fn func()) {
	s.mu.Lock()
	s.laterFns = append(s.laterFns, fn)
	s.mu.Unlock()
	s.opts.Wake()
}

// newSession creates a session in the workspace with an Agent and opens
// it.
func (s *Shell) newSession(ws model.Workspace, kind agent.Kind) {
	x, err := s.wb.NewSession(ws.ID, kind, "")
	if err != nil {
		s.notice = "新建会话失败：" + err.Error()
		return
	}
	s.current = x.ID
}

// send sends the session's draft.
func (s *Shell) send(id string, text string) bool {
	if err := s.wb.Send(id, text); err != nil {
		// A native session that cannot be resumed has its own banner.
		if !errors.Is(err, agent.ErrResumeFailed) && !errors.Is(err, workbench.ErrNeedsRecovery) {
			s.notice = err.Error()
		}
		return false
	}
	return true
}

func workspaceName(ws model.Workspace) string { return filepath.Base(ws.Path) }

func sessionTitle(x model.Session) string {
	if x.Title == "" {
		return "新会话"
	}
	return x.Title
}

// notifyApprovals notifies of new approval requests in sessions not on
// screen.
func (s *Shell) notifyApprovals(changes []workbench.Change) {
	if s.seen == nil {
		s.seen = map[string]int{}
	}
	done := map[string]bool{}
	for _, c := range changes {
		id := c.SessionID
		if id == "" || done[id] {
			continue
		}
		done[id] = true
		n := s.wb.Status(id).Approvals
		if n > s.seen[id] && id != s.current && s.opts.Notify != nil {
			x, _ := s.wb.Session(id)
			s.opts.Notify(id, "「"+sessionTitle(x)+"」需要审批", s.agentName(x.Agent)+" 在等你批准一个操作")
		}
		s.seen[id] = n
	}
}

// Open opens a session, as when its notification is clicked. It runs on
// the main thread.
func (s *Shell) Open(sessionID string) {
	if _, ok := s.wb.Session(sessionID); ok {
		s.current = sessionID
	}
}
