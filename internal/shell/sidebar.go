package shell

import (
	"fmt"
	"runtime"
	"strings"
	"time"

	"github.com/chldu2000/aibo/locales"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// sidebarUI is the sidebar's state.
type sidebarUI struct {
	query        string
	showArchived bool
	// renaming is the session being renamed, with its new title; deleting
	// the one whose deletion waits for confirmation.
	renaming, newTitle string
	deleting           string
	search             search
	// collapsed is the user's choice to hide the sidebar, kept as a
	// preference. A narrow window hides it too, without changing that
	// choice; narrowOpen is set while the user shows it there anyway.
	collapsed, narrowOpen bool
	// hidden is whether this frame hides the sidebar.
	hidden bool
	// resized is when the width last moved, until it is kept; zero
	// when it is.
	resized time.Time
	// folded are the workspaces whose sessions are folded under their
	// name, kept as a preference; more those showing all their sessions.
	folded, more map[string]bool
}

// foldedPref is the preference keeping which workspaces are folded.
const foldedPref = "foldedWorkspaces"

// groupShows is how many of a workspace's sessions show, the most
// recent, until it shows all.
const groupShows = 8

// collapsedPref is the preference keeping whether the sidebar is hidden.
const collapsedPref = "sidebarCollapsed"

// widthPref is the preference keeping the sidebar's width.
const widthPref = "sidebarWidth"

// The sidebar's width: as it starts and as a double click on its divider
// puts it back, and the least and most it takes.
const sidebarWidth, sidebarMin, sidebarMax = 260, 200, 480

// widthRest is how long the width has to rest after a move before it is
// kept, so that a drag is kept once, as it ends.
const widthRest = 300 * time.Millisecond

// sidebarResized keeps the sidebar's width within its bounds and, once it
// rests after a move, as a preference.
func (s *Shell) sidebarResized(c *ui.Context, moved bool) {
	s.split = min(max(s.split, sidebarMin), sidebarMax)
	now := c.Now()
	if moved {
		s.side.resized = now
	}
	if s.side.resized.IsZero() {
		return
	}
	if due := s.side.resized.Add(widthRest); now.Before(due) {
		c.After(due.Sub(now))
		return
	}
	s.side.resized = time.Time{}
	if err := s.wb.SetPref(widthPref, s.split); err != nil {
		s.notice = s.say(err)
	}
}

// narrowWindow is the width under which the window hides the sidebar.
const narrowWindow = 640

// sidebarHidden works out whether the sidebar is hidden this frame: as
// the user chose, or for a narrow window, unless shown there anyway.
func (s *Shell) sidebarHidden(c *ui.Context) bool {
	if s.opts.Only != "" {
		return true
	}
	if w, _ := c.Size(); w < narrowWindow {
		return !s.side.narrowOpen
	}
	s.side.narrowOpen = false
	return s.side.collapsed
}

// toggleSidebar hides the sidebar or shows it. In a narrow window that
// is for now; otherwise it is kept for the next launch too.
func (s *Shell) toggleSidebar(c *ui.Context) {
	if w, _ := c.Size(); w < narrowWindow {
		s.side.narrowOpen = !s.side.narrowOpen
		return
	}
	s.side.collapsed = !s.side.collapsed
	if err := s.wb.SetPref(collapsedPref, s.side.collapsed); err != nil {
		s.notice = s.say(err)
	}
}

// sidebarButton hides or shows the sidebar, as its symbol says.
func (s *Shell) sidebarButton(c *ui.Context) {
	label := locales.HideSidebar()
	if s.side.hidden {
		label = locales.ShowSidebar()
	}
	label = locales.WithShortcut(label, cmdKey(`\`))
	if iconButton(c, "sidebar.leading", label).Clicked() {
		s.toggleSidebar(c)
	}
}

// search is the sidebar's search: the query as last typed and when, and
// the results of the last query asked, which show until the next one's
// come.
type search struct {
	typed   string
	typedAt time.Time
	// asked is the query searched for, or being searched for while busy;
	// stale is set when sessions changed after it was asked.
	asked       string
	busy, stale bool
	// found are the results for shown, more how many more there were.
	shown string
	found []workbench.Found
	more  int
	err   error
}

// searchDelay is how long the query has to rest before it is searched
// for, so that typing a word does not search for each of its letters.
const searchDelay = 200 * time.Millisecond

// searchLimit is the most sessions the search shows.
const searchLimit = 50

// sidebar is the sidebar, from edge to edge of the window: search, the
// workspaces with their sessions, and the archived ones. Where the window
// shows Mica (micaSidebar) it draws nothing under them; elsewhere it is
// Liquid Glass.
func (s *Shell) sidebar(c *ui.Context) {
	t := c.Theme()
	side := ui.Column(c).Fill().Key("sidebar").Transition(sidebarMotion)
	if !micaSidebar(c) {
		side.Material(glass.Glass{Native: true})
	}
	side.Children(func() {
		// The header, from under the traffic lights, moves the window;
		// its search and buttons take their own presses.
		ui.Column(c).Gap(6).Padding(max(c.TitleBar().Bottom+6, 10), 10, 4).DragWindow().Children(func() {
			ui.Row(c).Padding(0, 6, 4).AlignItems(ui.Center).Children(func() {
				ui.Text(c, "aibo").Bold().FontSize(15).TextColor(t.Text)
				ui.Spacer(c)
				if iconButton(c, "folder.badge.plus", locales.AddWorkspace()).Clicked() {
					s.addWorkspace()
				}
				s.sidebarButton(c)
			})
			s.newSessionBar(c)
			ui.TextInput(c, &s.side.query).Placeholder(locales.SearchSessions()).Label(locales.SearchSessions())
		})
		ui.Scroll(c).Grow(1).Children(func() {
			ui.Column(c).Gap(2).Padding(4, 10, 10).Children(func() {
				if s.side.query != "" {
					s.searchResults(c)
				} else {
					s.workspaceGroups(c)
				}
			})
		})
		ui.Row(c).Padding(8, 10).AlignItems(ui.Center).Children(func() {
			if iconButton(c, "gearshape", locales.WithShortcut(locales.SettingsButton(), cmdKey(","))).Clicked() {
				s.openSettings()
			}
			ui.Spacer(c)
		})
	})
}

// sidebarMotion slides the sidebar in from the left edge as it shows.
var sidebarMotion = ui.ElementTransition{
	Duration: 180 * time.Millisecond,
	Enter:    &ui.Motion{X: -24},
}

// micaSidebar reports whether the sidebar shows the window's Mica: on
// Windows 11 22H2 and later, where DWM draws it behind the window, under
// a root without a background. Glass would not show it: its shader
// samples only what the frame painted.
func micaSidebar(c *ui.Context) bool {
	return runtime.GOOS == "windows" && c.Vibrancy()
}

func (s *Shell) workspaceGroups(c *ui.Context) {
	t := c.Theme()
	workspaces := s.wb.Workspaces()
	if len(workspaces) == 0 {
		ui.Column(c).Gap(10).Padding(16, 6).Children(func() {
			ui.Text(c, locales.NoWorkspaces()).FontSize(12).TextColor(t.TextMuted)
			if ui.Button(c, locales.AddWorkspaceMenu()).Clicked() {
				s.addWorkspace()
			}
		})
	}
	sessions := s.wb.Sessions()
	for _, ws := range workspaces {
		var group []model.Session
		for _, x := range sessions {
			if x.WorkspaceID == ws.ID && !x.Archived {
				group = append(group, x)
			}
		}
		folded := s.side.folded[ws.ID]
		header := ui.Row(c).Padding(10, 6, 4).Gap(6).AlignItems(ui.Center).Key(ws.ID).Children(func() {
			name := workspaceName(ws)
			label := locales.FoldWorkspace(name)
			symbol := "chevron.down"
			if folded {
				label, symbol = locales.UnfoldWorkspace(name), "chevron.right"
			}
			toggle := ui.Row(c).Gap(4).AlignItems(ui.Center).Grow(1).MinWidth(0).Label(label).Cursor(ui.CursorPointer).Children(func() {
				icon(c, symbol).Size(10).Color(t.TextMuted)
				ui.Text(c, name).FontSize(12).Bold().TextColor(t.TextMuted).Tooltip(ws.Path).MaxLines(1).Shrink(1).MinWidth(0)
			})
			if toggle.Clicked() {
				s.foldWorkspace(ws.ID, !folded)
			}
			if ws.Missing {
				ui.Text(c, locales.FolderMissing()).FontSize(11).TextColor(t.Warning)
			}
			if folded {
				s.groupBusy(c, group)
			}
			s.newSessionButton(c, ws)
		})
		header.ContextMenu(func(m *ui.Menu) {
			if m.Item(locales.Relocate()).Chosen() {
				s.relocate(ws)
			}
			if s.opts.ShowInFinder != nil && m.Item(showInLabel()).Disabled(ws.Missing).Chosen() {
				s.opts.ShowInFinder(ws.Path)
			}
			m.Separator()
			if m.Item(locales.RemoveWorkspace()).Chosen() {
				if err := s.wb.RemoveWorkspace(ws.ID); err != nil {
					s.notice = s.say(err)

				}
			}
		})
		if !folded {
			s.groupRows(c, ws, group)
		}
	}
	var archived []model.Session
	for _, x := range sessions {
		if x.Archived {
			archived = append(archived, x)
		}
	}
	if len(archived) > 0 {
		label := locales.ArchivedCount(len(archived))
		ui.Collapsible(c, label, &s.side.showArchived, func() {
			for _, x := range archived {
				s.sessionRow(c, x)
			}
		})
	}
}

// sessionRow is a session in the sidebar: its Agent, its title, how it
// stands; a click opens it, a right-click its menu.
func (s *Shell) sessionRow(c *ui.Context, x model.Session) {
	t := c.Theme()
	row := ui.Row(c).Key(x.ID).Gap(8).Padding(6, 8).Radius(7).AlignItems(ui.Center).Children(func() {
		s.agentGlyph(c, x.Agent, 18)
		ui.Text(c, sessionTitle(x)).TextColor(t.Text).MaxLines(1).Grow(1).MinWidth(0)
		s.marks(c, x)
		if !x.ActiveAt.IsZero() {
			c.After(time.Minute) // the time shown moves on
			ui.Text(c, ago(c.Now(), x.ActiveAt)).FontSize(11).TextColor(t.TextMuted).NoWrap().Tooltip(x.ActiveAt.Format("2006-01-02 15:04"))
		}
	})
	if x.ID == s.current {
		row.Background(t.SurfacePressed)
	} else if row.Hovered() {
		row.Background(t.SurfaceHover)
	}
	// The last words, read only for the row under the pointer.
	if row.Hovered() {
		if w := s.wb.LastWords(x.ID); w != "" {
			row.Tooltip(oneLine(strings.ReplaceAll(strings.TrimSpace(w), "\n", " "), 160))
		}
	}
	if row.Clicked() {
		s.current = x.ID
	}
	row.ContextMenu(func(m *ui.Menu) { s.sessionMenu(m, x) })
}

// sessionMenu is what can be done with a session, the same in its row's
// menu and the header's "…": what its Agent or the app cannot do is left
// out, and compacting waits for the turn to end.
func (s *Shell) sessionMenu(m *ui.Menu, x model.Session) {
	if s.wb.CanCompact(x.Agent) && m.Item(locales.Compact()).Disabled(s.wb.Status(x.ID).Running).Chosen() {
		if err := s.wb.Compact(x.ID); err != nil {
			s.notice = s.say(err)
		}
	}
	if m.Item(locales.RenameMenu()).Chosen() {
		s.side.renaming, s.side.newTitle = x.ID, x.Title
	}
	archive := locales.Archive()
	if x.Archived {
		archive = locales.Unarchive()
	}
	if m.Item(archive).Chosen() {
		if err := s.wb.SetArchived(x.ID, !x.Archived); err != nil {
			s.notice = s.say(err)
		}
	}
	if s.opts.OpenWindow != nil && m.Item(locales.OpenInWindow()).Chosen() {
		s.opts.OpenWindow(x.ID)
	}
	m.Separator()
	if m.Item(locales.DeleteMenu()).Chosen() {
		s.side.deleting = x.ID
	}
}

// marks are how a session stands, in the sidebar: waiting for approval,
// running, needing attention, and the references it received.
func (s *Shell) marks(c *ui.Context, x model.Session) {
	t := c.Theme()
	st := s.wb.Status(x.ID)
	dot := func(ink ui.Color, label, tip string) {
		ui.Box(c).Size(8, 8).Radius(4).Background(ink).Label(label).Tooltip(tip)
	}
	switch {
	case st.Approvals > 0:
		label := locales.PendingCount(st.Approvals)
		ui.Box(c).Height(16).MinWidth(16).Padding(0, 5).Radius(8).AlignItems(ui.Center).Justify(ui.Center).Background(t.Warning).Label(label).Tooltip(label).Children(func() {
			ui.Textf(c, "%d", st.Approvals).FontSize(10).Bold().TextColor(ui.RGBA(255, 255, 255, 1))
		})
	case st.Running:
		ui.Spinner(c).FontSize(11).Label(locales.Running()).Tooltip(locales.Running())
	case st.Error != nil || st.ResumeFailed != nil || st.NeedsLogin:
		dot(t.Danger, locales.FailedMark(), firstOf(s.say(st.ResumeFailed), s.say(st.Error), locales.AgentSignedOut(s.agentName(x.Agent))))
	case st.Unread:
		dot(t.Accent, locales.Unread(), locales.Unread())
	}
	if m := s.modeOf(x); m.Risk == agent.Danger {
		ui.Box(c).Label(m.Name + " · " + sessionTitle(x)).Tooltip(withDetail(m.Name, modeDescription(x.Agent, m))).Children(func() {
			icon(c, "exclamationmark.shield").Size(12).Color(t.Warning)
		})
	}
	if n := s.wb.Received(x.ID); n > 0 {
		ui.Text(c, locales.RefsCount(n)).FontSize(11).TextColor(t.TextMuted).Tooltip(locales.RefsReceived(n))
	}
}

func firstOf(xs ...string) string {
	for _, x := range xs {
		if x != "" {
			return x
		}
	}
	return ""
}

// searchFor searches for the query once it has rested for searchDelay,
// off the main thread, one search at a time; and again when sessions
// changed since. Until the results come, the last ones show.
func (s *Shell) searchFor(c *ui.Context) {
	q := &s.side.search
	text := strings.TrimSpace(s.side.query)
	now := c.Now()
	if text != q.typed {
		q.typed, q.typedAt = text, now
	}
	if q.busy || q.asked == text && !q.stale {
		return
	}
	if due := q.typedAt.Add(searchDelay); now.Before(due) {
		c.After(due.Sub(now))
		return
	}
	q.asked, q.busy, q.stale = text, true, false
	go func() {
		found, more, err := s.wb.SearchSessions(text, searchLimit)
		s.later(func() {
			q.busy = false
			q.shown, q.found, q.more, q.err = text, found, more, err
		})
	}()
}

// searchChanged marks the search's results stale after sessions or their
// finished messages changed; a message still streaming leaves them, so
// that a reply coming does not search again for each of its words.
func (s *Shell) searchChanged(pending []workbench.Change) {
	q := &s.side.search
	if q.asked == "" || q.stale {
		return
	}
	for _, ch := range pending {
		if ch.Message == nil || ch.Message.State != model.Streaming {
			// Searched again at once: the query has rested.
			q.stale = true
			return
		}
	}
}

// searchResults are the sessions whose titles or messages hold the
// query, archived ones too.
func (s *Shell) searchResults(c *ui.Context) {
	t := c.Theme()
	s.searchFor(c)
	q := &s.side.search
	text := strings.TrimSpace(s.side.query)
	if q.shown != text || q.busy {
		ui.Row(c).Gap(6).Padding(6, 6).AlignItems(ui.Center).Children(func() {
			ui.Spinner(c)
			ui.Text(c, locales.Searching()).FontSize(11).TextColor(t.TextMuted)
		})
		if q.shown == "" {
			return
		}
	}
	if q.err != nil {
		ui.Text(c, s.say(q.err)).FontSize(12).TextColor(t.Warning)
		return
	}
	found := q.found
	if len(found) == 0 && q.shown == text {
		ui.Text(c, locales.NoSessionsFound()).FontSize(12).TextColor(t.TextMuted).Padding(10, 6)
	}
	defer func() {
		if q.more > 0 {
			ui.Text(c, locales.SearchMore(q.more)).FontSize(11).TextColor(t.TextMuted).Padding(8, 6)
		}
	}()
	for _, f := range found {
		x := f.Session
		row := ui.Column(c).Key(x.ID).Gap(2).Padding(6, 8).Radius(7).Children(func() {
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				s.agentGlyph(c, x.Agent, 16)
				ui.Text(c, sessionTitle(x)).TextColor(t.Text).MaxLines(1).Grow(1)
				if x.Archived {
					ui.Text(c, locales.Archived()).FontSize(11).TextColor(t.TextMuted)
				}
			})
			if f.Snippet != "" {
				ui.Text(c, f.Snippet).FontSize(11).TextColor(t.TextMuted).MaxLines(2)
			}
		})
		if row.Hovered() {
			row.Background(t.SurfaceHover)
		}
		if row.Clicked() {
			s.current = x.ID
		}
	}
}

// newSessionButton is a workspace's "+": the Agent of the new session,
// which starts with the Agent's own default model. A lone Agent that can
// start needs no choosing.
func (s *Shell) newSessionButton(c *ui.Context, ws model.Workspace) {
	t := c.Theme()
	plus := iconButton(c, "plus", locales.NewSessionIn(workspaceName(ws)))
	if plus.Clicked() {
		all := s.wb.Agents()
		if ok, _ := s.agentOK(all[0].Kind); len(all) == 1 && ok {
			s.newSession(ws, all[0].Kind)
		} else {
			s.choosingAgent = ws.ID
		}
	}
	if s.choosingAgent != ws.ID {
		return
	}
	open := true
	ui.Popover(c, plus, &open, func() {
		ui.Column(c).Width(280).Gap(2).Padding(8).Children(func() {
			ui.Text(c, locales.NewSession()).Bold().TextColor(t.Text).Padding(0, 6, 4)
			s.agentChoices(c, func(a workbench.AgentInfo) string { return locales.NewSessionWith(a.Name) }, func(kind agent.Kind) {
				s.newSession(ws, kind)
				open = false
			})
		})
	})
	if !open {
		s.choosingAgent = ""
	}
}

// relocate asks where a workspace's folder is now.
func (s *Shell) relocate(ws model.Workspace) {
	if s.opts.ChooseFolder == nil {
		return
	}
	go func() {
		p, ok := s.opts.ChooseFolder()
		if !ok {
			return
		}
		if err := s.wb.Relocate(ws.ID, p); err != nil {
			s.later(func() { s.notice = s.failed(locales.RelocateFailed, err) })
		}
	}()
}

// renameDialog renames a session.
func (s *Shell) renameDialog(c *ui.Context) {
	if s.side.renaming == "" {
		return
	}
	t := c.Theme()
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(380).Gap(10).Children(func() {
			ui.Text(c, locales.RenameSession()).Bold().TextColor(t.Text)
			in := ui.TextInput(c, &s.side.newTitle).Label(locales.SessionTitle()).Placeholder(locales.TitlePlaceholder()).AutoFocus()
			ui.Row(c).Gap(6).Children(func() {
				ui.Spacer(c)
				if ui.Button(c, locales.Cancel()).Clicked() {
					open = false
				}
				if ui.PrimaryButton(c, locales.Ok()).Clicked() || in.Submitted() {
					if err := s.wb.Rename(s.side.renaming, s.side.newTitle); err != nil {
						s.notice = s.say(err)

					}
					open = false
				}
			})
		})
	})
	if !open {
		s.side.renaming = ""
	}
}

// deleteDialog asks before deleting a session, saying which references
// that breaks.
func (s *Shell) deleteDialog(c *ui.Context) {
	id := s.side.deleting
	if id == "" {
		return
	}
	t := c.Theme()
	x, _ := s.wb.Session(id)
	n := s.wb.ReferencesTo(id)
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(420).Gap(10).Children(func() {
			ui.Text(c, locales.DeleteSession(sessionTitle(x))).Bold().TextColor(t.Text)
			ui.Text(c, locales.DeleteExplain()).FontSize(12).TextColor(t.Text)
			if n > 0 {
				ui.Text(c, locales.DeleteRefs(n)).FontSize(12).Bold().TextColor(t.Warning)
			}
			ui.Row(c).Gap(6).Children(func() {
				ui.Spacer(c)
				if ui.Button(c, locales.Cancel()).Clicked() {
					open = false
				}
				if ui.Button(c, locales.Delete()).Label(locales.ConfirmDelete()).TextColor(t.Danger).Clicked() {
					if err := s.wb.DeleteSession(id); err != nil {
						s.notice = s.say(err)

					} else if s.current == id {
						s.current = ""
					}
					open = false
				}
			})
		})
	})
	if !open {
		s.side.deleting = ""
	}
}

// ago is how long ago then was, in short: just now, minutes, hours the
// same day, yesterday, else its date, with its year when not this one.
func ago(now, then time.Time) string {
	d := now.Sub(then)
	y, m, day := then.Date()
	switch {
	case d < time.Minute:
		return locales.JustNow()
	case d < time.Hour:
		return locales.MinutesAgo(fmt.Sprint(int(d / time.Minute)))
	case sameDay(now, then):
		return locales.HoursAgo(fmt.Sprint(int(d / time.Hour)))
	case sameDay(now.AddDate(0, 0, -1), then):
		return locales.Yesterday()
	case y == now.Year():
		return locales.MonthDay(fmt.Sprint(int(m)), fmt.Sprint(day))
	}
	return locales.YearMonthDay(fmt.Sprint(y), fmt.Sprint(int(m)), fmt.Sprint(day))
}

func sameDay(a, b time.Time) bool {
	ay, am, ad := a.Date()
	by, bm, bd := b.Date()
	return ay == by && am == bm && ad == bd
}

// groupRows are a workspace's sessions: the most recent groupShows, and
// any other that is open, running, waiting or unread, until the user
// shows all; then a line to show the others, or fewer.
func (s *Shell) groupRows(c *ui.Context, ws model.Workspace, group []model.Session) {
	t := c.Theme()
	all := s.side.more[ws.ID]
	hidden := 0
	for i, x := range group {
		st := s.wb.Status(x.ID)
		if all || i < groupShows || x.ID == s.current || st.Running || st.Approvals > 0 || st.Unread {
			s.sessionRow(c, x)
		} else {
			hidden++
		}
	}
	if hidden == 0 && (!all || len(group) <= groupShows) {
		return
	}
	text := locales.ShowMoreSessions(hidden)
	if all {
		text = locales.ShowFewerSessions()
	}
	line := ui.Row(c).Key("more/"+ws.ID).Padding(4, 8).Radius(7).Label(text + " · " + workspaceName(ws)).Cursor(ui.CursorPointer).Children(func() {
		ui.Text(c, text).FontSize(12).TextColor(t.TextMuted)
	})
	if line.Hovered() {
		line.Background(t.SurfaceHover)
	}
	if line.Clicked() {
		s.side.more[ws.ID] = !all
	}
}

// groupBusy counts, by a folded workspace's name, its sessions running
// and the approvals they wait on.
func (s *Shell) groupBusy(c *ui.Context, group []model.Session) {
	t := c.Theme()
	running, approvals := 0, 0
	for _, x := range group {
		st := s.wb.Status(x.ID)
		if st.Running {
			running++
		}
		approvals += st.Approvals
	}
	if running > 0 {
		label := locales.RunningCount(running)
		ui.Text(c, label).FontSize(11).TextColor(t.TextMuted).NoWrap()
	}
	if approvals > 0 {
		label := locales.PendingCount(approvals)
		ui.Text(c, label).FontSize(11).Bold().TextColor(t.Warning).NoWrap()
	}
}

// foldWorkspace folds a workspace's sessions under its name, or unfolds
// them, and keeps it so.
func (s *Shell) foldWorkspace(id string, fold bool) {
	if fold {
		s.side.folded[id] = true
	} else {
		delete(s.side.folded, id)
	}
	if err := s.wb.SetPref(foldedPref, s.side.folded); err != nil {
		s.notice = s.say(err)
	}
}

// agentChoices are the Agents to start a session with, each labelled by
// label; those that cannot start are grayed, with why.
func (s *Shell) agentChoices(c *ui.Context, label func(workbench.AgentInfo) string, pick func(agent.Kind)) {
	t := c.Theme()
	for _, a := range s.wb.Agents() {
		if ok, why := s.agentOK(a.Kind); !ok {
			ui.Row(c).Key(string(a.Kind)).Gap(8).Padding(6, 8).Opacity(0.5).Children(func() {
				s.agentGlyph(c, a.Kind, 16)
				ui.Column(c).Grow(1).Children(func() {
					ui.Text(c, a.Name).TextColor(t.Text)
					ui.Text(c, why).FontSize(11).TextColor(t.TextMuted)
				})
			})
			continue
		}
		if pickRow(c, string(a.Kind), label(a), func() {
			s.agentGlyph(c, a.Kind, 16)
			ui.Text(c, a.Name).TextColor(t.Text).Grow(1)
		}).Clicked() {
			pick(a.Kind)
		}
	}
}
