package shell

import (
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
			s.starter = starter{open: true}
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
		s.starter = starter{open: true}
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
		s.starter = starter{open: true}
		return
	}
	ws := s.workspaceOf(x)
	if ws.ID == "" || ws.Missing {
		s.starter = starter{open: true}
		return
	}
	if usable, why := s.agentOK(x.Agent); !usable {
		s.starter = starter{open: true, why: locales.AgentUnusable(s.agentName(x.Agent), why)}
		return
	}
	s.newSession(ws, x.Agent)
}

// starterDialog chooses a workspace and an Agent for a new session: each
// workspace there, with its Agents, those that cannot start grayed.
func (s *Shell) starterDialog(c *ui.Context) {
	if !s.starter.open {
		return
	}
	t := c.Theme()
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(380).Gap(10).Children(func() {
			ui.Text(c, locales.NewSession()).Bold().TextColor(t.Text)
			if s.starter.why != "" {
				ui.Text(c, s.starter.why).FontSize(12).TextColor(t.Warning)
			}
			var workspaces []model.Workspace
			for _, ws := range s.wb.Workspaces() {
				if !ws.Missing {
					workspaces = append(workspaces, ws)
				}
			}
			if len(workspaces) == 0 {
				ui.Text(c, locales.NoWorkspaces()).FontSize(12).TextColor(t.TextMuted)
				if ui.Button(c, locales.AddWorkspaceMenu()).Clicked() {
					open = false
					s.addWorkspace()
				}
			}
			ui.Scroll(c).MaxHeight(360).Children(func() {
				ui.Column(c).Gap(8).Children(func() {
					for _, ws := range workspaces {
						ui.Column(c).Key(ws.ID).Gap(2).Children(func() {
							sectionTitle(c, workspaceName(ws))
							s.agentChoices(c, func(a workbench.AgentInfo) string {
								return locales.NewSessionWithIn(a.Name, workspaceName(ws))
							}, func(kind agent.Kind) {
								s.newSession(ws, kind)
								open = false
							})
						})
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
