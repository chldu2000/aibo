// Package shell is the workbench's window: a floating Liquid Glass
// sidebar of workspaces and their sessions, and the session pane with its
// messages and composer. It only calls the workbench core's operations,
// and learns of changes through Workbench.Subscribe.
package shell

import (
	"errors"
	"github.com/chldu2000/aibo/locales"
	"path/filepath"
	"sync"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agents"
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
	// Agents is the Agents as found on this Mac, for the settings' Agent
	// page, the login banners and the new-session picker; nil without.
	Agents *agents.Registry
	// OpenURL opens a web page in the browser.
	OpenURL func(url string)
	// OpenTerminal opens Terminal running an executable, for the user to
	// sign in there.
	OpenTerminal func(path string)
	// OpenWindow opens a session in a window of its own; nil hides the
	// header's button.
	OpenWindow func(sessionID string)
	// ChooseFile asks for an executable, blocking off the main thread.
	ChooseFile func() (string, bool)
	// ChooseImages asks for images to attach, blocking off the main
	// thread; nil leaves the composer's paperclip out.
	ChooseImages func() ([]string, bool)
	// OpenFile opens a file in its app, as an attached image in the
	// system's viewer.
	OpenFile func(path string)
	// DataDir is the data directory in use, which the settings show.
	DataDir string
	// MoveDataDir moves the data to another directory and starts aibo
	// again on it; nil leaves the data directory unchangeable.
	MoveDataDir func(to string) error
	// ShowInFinder reveals a path in Finder.
	ShowInFinder func(path string)
	// OpenLogs, when set, opens the diagnostic log's directory.
	OpenLogs func()
	// ChooseFolder asks the user for a folder to add as a workspace,
	// blocking until they choose; ok is false when they cancel. It runs
	// off the main thread.
	ChooseFolder func() (path string, ok bool)
	// Only, when set, makes the shell a session's own window: it shows
	// that session's area alone, without the sidebar, and never notifies
	// (the main window does).
	Only string
	// ShowInMain shows another session in the main window, messages
	// from..to highlighted (none when zero), for a shell showing Only one:
	// as when a reference's source is opened from it.
	ShowInMain func(sessionID string, from, to int)
}

// Shell is the window's state.
type Shell struct {
	window WindowControls
	wb     *workbench.Workbench
	opts   Options

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
	// cmds is the "/" panel.
	cmds commandPanel
	// choosingAgent is the workspace whose "+" shows the Agents to start
	// a session with.
	choosingAgent string
	// focusComposer is the session to refocus once its reference picker closes.
	focusComposer string
	// side is the sidebar's state.
	side sidebarUI
	// glyphs are the Agents' icons, worked out once per name.
	glyphs map[agent.Kind]agentIcon
	// modelMenu holds the composer's model and effort menus.
	modelMenu modelState
	// detail is the session details panel.
	detail detailsUI
	// settings is the global settings' modal.
	settings        settingsUI
	agentChangeBusy bool
	// level is the approval control's popover.
	// modes are the permission modes each Agent told; modeMenu the
	// composer's popover of them.
	modes    map[agent.Kind]*modes
	modeMenu modeState
	// seen counts each session's approval requests last seen, to notify
	// of new ones.
	seen map[string]int
	// approvals are the approval cards' states, by request ID.
	approvals map[string]*approvalUI
	// openCards are the reference cards showing their briefs.
	openCards map[string]bool
	// thumbs are the attachments' pictures, by file.
	thumbs map[string]*thumb
	// unsubscribe stops the workbench's changes coming (Close).
	unsubscribe func()
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
	// mentions are the files the draft mentions.
	mentions []model.Mention
	// command is the Agent command the draft invokes, its chip; the
	// draft is then what follows it.
	command *agent.Command
	// caretEnd puts the caret at the end of the draft as the composer is
	// next built, after the draft changed under it.
	caretEnd bool
	// attachments are the images the draft carries; attaching counts
	// those still being added, which the draft waits for.
	attachments []model.Attachment
	attaching   int
	// pasted is set by a paste into the draft, which is not typing.
	pasted bool
	// sel is selection mode.
	sel selection
	// open is which disclosures of the messages are open.
	open open
	// highlight is the range of sequence numbers shown highlighted, as
	// when jumping to what a reference covers; zero for none.
	highlight [2]int
	// composerHeight is how tall the composer and what floats above it were
	// last frame, which the messages leave room for under their last.
	composerHeight float32
	// hover is the message the pointer was over last frame, by its seq,
	// which shows its number then; 0 when none.
	hover int
	// bannersOpen shows all the notices above the composer, past two.
	bannersOpen bool
	// follow is what the view knows of the messages' end, for the button
	// back to it.
	follow follow
}

// New returns the shell of wb.
func New(wb *workbench.Workbench, o Options) *Shell {
	if o.Wake == nil {
		o.Wake = func() {}
	}
	s := &Shell{wb: wb, opts: o, split: sidebarWidth, views: map[string]*sessionView{}, openCards: map[string]bool{}}
	if o.Only != "" {
		o.Notify = nil
	}
	s.unsubscribe = wb.Subscribe(func(c workbench.Change) {
		s.mu.Lock()
		s.pending = append(s.pending, c)
		s.mu.Unlock()
		o.Wake()
	})
	if _, err := wb.Pref(collapsedPref, &s.side.collapsed); err != nil {
		s.notice = s.say(err)
	}
	if _, err := wb.Pref(widthPref, &s.split); err != nil {
		s.notice = s.say(err)
	}
	s.split = min(max(s.split, sidebarMin), sidebarMax)
	if _, err := wb.Pref(pagePref, &s.detail.page); err != nil {
		s.notice = s.say(err)
	}
	if !knownPage(s.detail.page) {
		s.detail.page = ""
	}
	if o.Only != "" {
		s.current = o.Only
	} else if all := wb.Sessions(); len(all) > 0 {
		s.current = all[0].ID
	}
	return s
}

// Close stops the shell following the workbench, as when its window
// closes.
func (s *Shell) Close() {
	// A width moved just before is kept, though it did not rest.
	if !s.side.resized.IsZero() {
		_ = s.wb.SetPref(widthPref, s.split)
	}
	s.closeChildHistory()
	s.watchPanel("")
	s.unsubscribe()
}

// goTo shows a session, messages from..to highlighted (none when zero).
// A session's own window shows no other: the main window does.
func (s *Shell) goTo(sessionID string, from, to int) {
	if s.opts.Only != "" && sessionID != s.opts.Only {
		if s.opts.ShowInMain != nil {
			s.opts.ShowInMain(sessionID, from, to)
		}
		return
	}
	if from > 0 {
		s.reveal(sessionID, from, to)
		return
	}
	s.current = sessionID
}

// Reveal shows a session at messages from..to, highlighted, as for a
// session's own window (ShowInMain). It runs on the main thread.
func (s *Shell) Reveal(sessionID string, from, to int) {
	if _, ok := s.wb.Session(sessionID); !ok {
		return
	}
	s.goTo(sessionID, from, to)
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
	s.searchChanged(pending)
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
		v.list.Key = func(i int) any {
			if i >= len(v.msgs) {
				return "working" // the line saying the turn runs
			}
			return v.msgs[i].Seq
		}
		v.list.FollowEnd = true
		v.list.FollowAnimation = &ui.Smooth
		s.views[id] = v
	}
	if !v.loaded {
		msgs, err := s.wb.Messages(id)
		if err != nil {
			s.notice = s.say(err)
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
			s.later(func() { s.notice = s.failed(locales.AddWorkspaceFailed, err) })
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
		s.notice = s.failed(locales.NewSessionFailed, err)
		return
	}
	s.goTo(x.ID, 0, 0)
}

// send sends the session's draft.
func (s *Shell) send(id string, text string) bool {
	o := workbench.Outgoing{Text: text}
	if v := s.views[id]; v != nil {
		o.Mentions, o.Attachments = v.mentions, v.attachments
		if v.command != nil {
			o.Command = v.command.Name
		}
	}
	if err := s.wb.SendMessage(id, o); err != nil {
		var pick *workbench.PickError
		if errors.As(err, &pick) {
			// Chosen with the control instead: its menu opens.
			s.openControl(id, pick.Control)
			if v := s.views[id]; v != nil {
				v.command = nil
			}
			return true
		}
		// A native session that cannot be resumed has its own banner.
		if !errors.Is(err, agent.ErrResumeFailed) && !errors.Is(err, workbench.ErrNeedsRecovery) && !errors.Is(err, agents.ErrNotLoggedIn) {
			s.notice = s.say(err)
		}
		return false
	}
	if v := s.views[id]; v != nil {
		v.mentions, v.attachments, v.command = nil, nil, nil
	}
	return true
}

func workspaceName(ws model.Workspace) string { return filepath.Base(ws.Path) }

func sessionTitle(x model.Session) string {
	if x.Title == "" {
		return locales.UntitledSession()
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
		if n > s.seen[id] && id != s.current && s.opts.Notify != nil && s.wb.Settings().Notify {
			x, _ := s.wb.Session(id)
			s.opts.Notify(id, locales.NotifyTitle(sessionTitle(x)), locales.NotifyBody(s.agentName(x.Agent)))

		}
		s.seen[id] = n
	}
}

// Open opens a session, as when its notification is clicked. It runs on
// the main thread.
func (s *Shell) Open(sessionID string) {
	if _, ok := s.wb.Session(sessionID); ok {
		s.goTo(sessionID, 0, 0)
	}
}

// OpenSettings opens the global settings, as ⌘, does.
func (s *Shell) OpenSettings() { s.openSettings() }
