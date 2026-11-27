package shell

import (
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

// starter is the new-session dialog: open, and why it opened when the
// Agent at hand could not start one.
type starter struct {
	open bool
	why  string
	// workspace is the one chosen, filter what narrows the list.
	workspace, filter string
}

// newSessionBar is the sidebar's way to start a session: "New session"
// starts one like the session at hand, the button beside it chooses where
// and with which Agent.
func (s *Shell) newSessionBar(c *ui.Context) {
	t := c.Theme()
	ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
		b := ui.Row(c).Key("new").Gap(6).Padding(6, 10).Radius(8).Grow(1).AlignItems(ui.Center).
			Background(veil(c, 0.05)).Label(locales.WithShortcut(locales.NewSessionHere(), cmdKey("N"))).Tooltip(locales.WithShortcut(locales.NewSessionHere(), cmdKey("N"))).Cursor(ui.CursorPointer).Children(func() {
			icon(c, "square.and.pencil").Size(14).Color(t.Text)
			ui.Text(c, locales.NewSession()).FontSize(13).TextColor(t.Text)
		})
		if b.Hovered() {
			b.Background(veil(c, 0.09))
		}
		if b.Clicked() {
			s.startLikeThis()
		}
		if iconButton(c, "chevron.down", locales.WithShortcut(locales.NewSessionChoose(), shiftCmdKey("N"))).Clicked() {
			s.openStarter("")
		}
	})
}

// newSessionKeys are ⌘N, a session like the one at hand, and ⇧⌘N, one
// chosen; not in a session's own window.
func (s *Shell) newSessionKeys(c *ui.Context) {
	if s.opts.Only != "" {
		return
	}
	if c.Shortcut(ui.Cmd|ui.Shift, ui.KeyN) {
		s.openStarter("")
	} else if c.Shortcut(ui.Cmd, ui.KeyN) {
		s.startLikeThis()
	}
}

// startLikeThis starts a session in the workspace of the open session,
// with its Agent; with none open, of the session last active. With none,
// or a workspace gone or an Agent that cannot start, it asks.
func (s *Shell) startLikeThis() {
	x, ok := s.wb.Session(s.current)
	if !ok {
		for _, y := range s.wb.Sessions() {
			if !y.Archived && (!ok || y.ActiveAt.After(x.ActiveAt)) {
				x, ok = y, true
			}
		}
	}
	if !ok {
		s.openStarter("")
		return
	}
	ws := s.workspaceOf(x)
	if ws.ID == "" || ws.Missing {
		s.openStarter("")
		return
	}
	if usable, why := s.agentOK(x.Agent); !usable {
		s.openStarter(locales.AgentUnusable(s.agentName(x.Agent), why))
		return
	}
	s.newSession(ws, x.Agent)
}

// openStarter opens the new-session dialog on the open session's
// workspace, saying why when it is not starting one directly.
func (s *Shell) openStarter(why string) {
	st := starter{open: true, why: why}
	if x, ok := s.wb.Session(s.current); ok {
		st.workspace = x.WorkspaceID
	}
	s.starter = st
}

// starterDialog chooses where a new session starts, in two columns: the
// workspaces, which a filter narrows, and the Agents for the one chosen,
// those that cannot start grayed. Choosing an Agent starts the session.
func (s *Shell) starterDialog(c *ui.Context) {
	if !s.starter.open {
		return
	}
	t := c.Theme()
	st := &s.starter
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(560).Gap(10).Children(func() {
			ui.Text(c, locales.NewSession()).Bold().TextColor(t.Text)
			if st.why != "" {
				ui.Text(c, st.why).FontSize(12).TextColor(t.Warning)
			}
			var all, shown []model.Workspace
			for _, ws := range s.wb.Workspaces() {
				if ws.Missing {
					continue
				}
				all = append(all, ws)
				q := strings.ToLower(strings.TrimSpace(st.filter))
				if q == "" || strings.Contains(strings.ToLower(workspaceName(ws)), q) || strings.Contains(strings.ToLower(ws.Path), q) {
					shown = append(shown, ws)
				}
			}
			if len(all) == 0 {
				ui.Text(c, locales.NoWorkspaces()).FontSize(12).TextColor(t.TextMuted)
				if ui.Button(c, locales.AddWorkspaceMenu()).Clicked() {
					open = false
					s.addWorkspace()
				}
				return
			}
			// The one chosen stays chosen while the filter shows it; else
			// the first shown is.
			chosen, ok := model.Workspace{}, false
			for _, ws := range shown {
				if ws.ID == st.workspace {
					chosen, ok = ws, true
				}
			}
			if !ok && len(shown) > 0 {
				chosen, ok = shown[0], true
				st.workspace = chosen.ID
			}
			// ↑ and ↓ move through the workspaces shown, Enter starts the
			// session with the Agent at hand.
			if ok {
				if step := keyStep(c); step != 0 {
					for i, ws := range shown {
						if ws.ID == chosen.ID {
							chosen = shown[min(max(i+step, 0), len(shown)-1)]
							break
						}
					}
					st.workspace = chosen.ID
				}
			}
			kind, usable := s.starterAgent()
			ui.Row(c).Gap(12).AlignItems(ui.Stretch).Height(320).Children(func() {
				ui.Column(c).Width(220).Gap(6).Children(func() {
					filter := ui.TextInput(c, &st.filter).Placeholder(locales.FilterWorkspaces()).Label(locales.FilterWorkspaces()).AutoFocus()
					if filter.Submitted() && ok && usable {
						s.newSession(chosen, kind)
						open = false
					}
					ui.Scroll(c).Grow(1).MinHeight(0).Children(func() {
						ui.Column(c).Gap(1).Children(func() {
							if len(shown) == 0 {
								ui.Text(c, locales.NoWorkspaceMatches()).FontSize(12).TextColor(t.TextMuted).Padding(6, 8)
							}
							for _, ws := range shown {
								row := ui.Row(c).Key(ws.ID).Gap(8).Padding(6, 8).Radius(7).AlignItems(ui.Center).Label(locales.PickWorkspace(workspaceName(ws))).Tooltip(ws.Path).Cursor(ui.CursorPointer).Children(func() {
									icon(c, "folder").Size(13).Color(t.TextMuted)
									ui.Text(c, workspaceName(ws)).TextColor(t.Text).MaxLines(1).Grow(1).MinWidth(0)
								})
								switch {
								case ws.ID == chosen.ID:
									row.Background(t.SurfacePressed)
								case row.Hovered():
									row.Background(t.SurfaceHover)
								}
								if row.Clicked() {
									st.workspace = ws.ID
								}
							}
						})
					})
				})
				ui.Box(c).Width(1).Background(t.Border)
				ui.Column(c).Grow(1).MinWidth(0).Gap(6).Children(func() {
					if !ok {
						return
					}
					ui.Text(c, workspaceName(chosen)).Bold().TextColor(t.Text).MaxLines(1)
					ui.Text(c, chosen.Path).FontSize(11).TextColor(t.TextMuted).MaxLines(1).TruncateMiddle()
					ui.Scroll(c).Grow(1).MinHeight(0).Children(func() {
						ui.Column(c).Gap(1).Children(func() {
							s.agentChoices(c, func(a workbench.AgentInfo) string { return locales.NewSessionWith(a.Name) }, func(kind agent.Kind) {
								s.newSession(chosen, kind)
								open = false
							})
						})
					})
					if usable {
						ui.Text(c, locales.EnterStarts(s.agentName(kind))).FontSize(11).TextColor(t.TextMuted)
					}
				})
			})
			ui.Row(c).Children(func() {
				ui.Spacer(c)
				if ui.Button(c, locales.Cancel()).Clicked() {
					open = false
				}
			})
		})
	})
	if !open {
		s.starter = starter{}
	}
}

// keyStep is -1 for ↑ and 1 for ↓ this frame, else 0.
func keyStep(c *ui.Context) int {
	switch {
	case c.Shortcut(0, ui.KeyUp):
		return -1
	case c.Shortcut(0, ui.KeyDown):
		return 1
	}
	return 0
}

// starterAgent is the Agent Enter starts a session with: the open
// session's, else the first that can.
func (s *Shell) starterAgent() (agent.Kind, bool) {
	if x, ok := s.wb.Session(s.current); ok {
		if usable, _ := s.agentOK(x.Agent); usable {
			return x.Agent, true
		}
	}
	for _, a := range s.wb.Agents() {
		if usable, _ := s.agentOK(a.Kind); usable {
			return a.Kind, true
		}
	}
	return "", false
}
