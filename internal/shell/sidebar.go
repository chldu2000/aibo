package shell

import (
	"runtime"

	"github.com/chldu2000/aibo/locales"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
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
}

// sidebar is the sidebar, from edge to edge of the window: search, the
// workspaces with their sessions, and the archived ones. Where the window
// shows Mica (micaSidebar) it draws nothing under them; elsewhere it is
// Liquid Glass.
func (s *Shell) sidebar(c *ui.Context) {
	t := c.Theme()
	side := ui.Column(c).Fill()
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
			})
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
			if iconButton(c, "gearshape", locales.SettingsButton()).Clicked() {
				s.openSettings()
			}
			ui.Spacer(c)
		})
	})
	s.renameDialog(c)
	s.deleteDialog(c)
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
		header := ui.Row(c).Padding(10, 6, 4).Gap(6).AlignItems(ui.Center).Key(ws.ID).Children(func() {
			ui.Text(c, workspaceName(ws)).FontSize(12).Bold().TextColor(t.TextMuted).Tooltip(ws.Path).MaxLines(1).Grow(1)
			if ws.Missing {
				ui.Text(c, locales.FolderMissing()).FontSize(11).TextColor(t.Warning)
			}
			s.newSessionButton(c, ws)
		})
		header.ContextMenu(func(m *ui.Menu) {
			if m.Item(locales.Relocate()).Chosen() {
				s.relocate(ws)
			}
			if s.opts.ShowInFinder != nil && m.Item(locales.ShowInFinder()).Disabled(ws.Missing).Chosen() {
				s.opts.ShowInFinder(ws.Path)
			}
			m.Separator()
			if m.Item(locales.RemoveWorkspace()).Chosen() {
				if err := s.wb.RemoveWorkspace(ws.ID); err != nil {
					s.notice = s.say(err)

				}
			}
		})
		for _, x := range sessions {
			if x.WorkspaceID == ws.ID && !x.Archived {
				s.sessionRow(c, x)
			}
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
		ui.Text(c, sessionTitle(x)).TextColor(t.Text).MaxLines(1).Grow(1)
		s.marks(c, x)
	})
	if x.ID == s.current {
		row.Background(t.SurfacePressed)
	} else if row.Hovered() {
		row.Background(t.SurfaceHover)
	}
	if row.Clicked() {
		s.current = x.ID
	}
	row.ContextMenu(func(m *ui.Menu) {
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
		m.Separator()
		if m.Item(locales.DeleteMenu()).Chosen() {
			s.side.deleting = x.ID
		}
	})
}

// marks are how a session stands, in the sidebar: waiting for approval,
// running, needing attention, and the references it received.
func (s *Shell) marks(c *ui.Context, x model.Session) {
	t := c.Theme()
	st := s.wb.Status(x.ID)
	switch {
	case st.Approvals > 0:
		ui.Text(c, locales.PendingCount(st.Approvals)).FontSize(11).Bold().TextColor(t.Warning)
	case st.Running:
		ui.Text(c, locales.Running()).FontSize(11).TextColor(t.TextMuted)
	case st.Error != nil || st.ResumeFailed != nil || st.NeedsLogin:
		ui.Text(c, locales.FailedMark()).FontSize(11).Bold().TextColor(t.Danger).Tooltip(firstOf(s.say(st.ResumeFailed), s.say(st.Error), locales.AgentSignedOut(s.agentName(x.Agent))))
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

// searchResults are the sessions whose titles or messages hold the
// query, archived ones too.
func (s *Shell) searchResults(c *ui.Context) {
	t := c.Theme()
	found, err := s.wb.SearchSessions(s.side.query)
	if err != nil {
		ui.Text(c, s.say(err)).FontSize(12).TextColor(t.Warning)
		return
	}
	if len(found) == 0 {
		ui.Text(c, locales.NoSessionsFound()).FontSize(12).TextColor(t.TextMuted).Padding(10, 6)
	}
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
			for _, a := range s.wb.Agents() {
				if ok, why := s.agentOK(a.Kind); !ok {
					// Unavailable: grayed, with why.
					ui.Row(c).Key(string(a.Kind)).Gap(8).Padding(6, 8).Opacity(0.5).Children(func() {
						s.agentGlyph(c, a.Kind, 16)
						ui.Column(c).Grow(1).Children(func() {
							ui.Text(c, a.Name).TextColor(t.Text)
							ui.Text(c, why).FontSize(11).TextColor(t.TextMuted)
						})
					})
					continue
				}
				if pickRow(c, string(a.Kind), locales.NewSessionWith(a.Name), func() {
					s.agentGlyph(c, a.Kind, 16)
					ui.Text(c, a.Name).TextColor(t.Text).Grow(1)
				}).Clicked() {
					s.newSession(ws, a.Kind)
					open = false
				}
			}
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
