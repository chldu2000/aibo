package shell

import (
	"context"
	"github.com/chldu2000/aibo/locales"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/egoist/mygo/ui"
)

// modes are the permission modes an Agent told, loaded once.
type modes struct {
	list    []agent.PermissionMode
	loading bool
}

// modesOf are an Agent's permission modes, loading them the first time;
// none while they load, or when it does not tell.
func (s *Shell) modesOf(kind agent.Kind) []agent.PermissionMode {
	if s.modes == nil {
		s.modes = map[agent.Kind]*modes{}
	}
	if m, ok := s.modes[kind]; ok {
		return m.list
	}
	m := &modes{loading: true}
	s.modes[kind] = m
	go func() {
		list, _ := s.wb.PermissionModes(context.Background(), kind)
		s.later(func() { m.loading, m.list = false, list })
	}()
	return nil
}

// modeOf is the session's permission mode as far as known: the one chosen,
// else the one the Agent says it is in, else its default. Its name is the
// ID when the Agent's list does not have it, "Default mode" when none is
// known.
func (s *Shell) modeOf(x model.Session) agent.PermissionMode {
	id := x.Mode
	if id == "" {
		id = s.wb.Status(x.ID).Mode
	}
	list := s.modesOf(x.Agent)
	for _, m := range list {
		if m.ID == id || id == "" && m.Default {
			return m
		}
	}
	if id == "" {
		return agent.PermissionMode{Name: locales.DefaultMode()}
	}
	return agent.PermissionMode{ID: id, Name: id}
}

// modeState is the composer's permission mode popover.
type modeState struct {
	open bool
	// confirming is a dangerous mode waiting for a second click.
	confirming string
}

// modeControl is the composer's permission mode: the session's, which a
// click opens to change, with the rules allowed for the session.
func (s *Shell) modeControl(c *ui.Context, x model.Session) {
	t := c.Theme()
	st := &s.modeMenu
	cur := s.modeOf(x)
	// A dangerous mode warns here, in orange, rather than in a banner that
	// would take the messages' room for as long as it lasts.
	danger := cur.Risk == agent.Danger
	symbol, color, tip := "checkmark.shield", t.TextMuted, locales.ModeTip()
	if danger {
		symbol, color, tip = "exclamationmark.shield", t.Warning, locales.ModeDangerTip(cur.Name, modeDescription(x.Agent, cur))
	}
	b := ui.Row(c).Gap(4).Padding(4, 8).Radius(8).AlignItems(ui.Center).Label(locales.ModeLabel(cur.Name)).Tooltip(tip).Children(func() {
		icon(c, symbol).Size(13).Color(color)
		ui.Text(c, cur.Name).FontSize(12).TextColor(color)
		if n := len(x.Rules); n > 0 {
			ui.Text(c, locales.RulesCount(n)).FontSize(12).TextColor(color)
		}
	})
	switch {
	case danger && b.Hovered():
		b.Background(tinted(c, ui.RGBA(255, 150, 0, 0.28)))
	case danger:
		b.Background(tinted(c, ui.RGBA(255, 150, 0, 0.18)))
	case b.Hovered():
		b.Background(t.SurfaceHover)
	}
	if b.Clicked() {
		st.open, st.confirming = !st.open, ""
	}
	ui.Popover(c, b, &st.open, func() {
		ui.Column(c).Width(400).Gap(8).Padding(14).Children(func() {
			ui.Text(c, locales.ModesOf(s.agentName(x.Agent))).Bold().TextColor(t.Text)
			if s.modeConfirm(c, x, &st.confirming) {
				st.open = false
				return
			}
			if st.confirming != "" {
				return
			}
			list := s.modesOf(x.Agent)
			if list == nil {
				ui.Text(c, locales.Loading()).FontSize(12).TextColor(t.TextMuted)
			}
			for _, m := range list {
				if s.modeRow(c, x.Agent, m, m.ID == cur.ID) && m.ID != cur.ID {
					if m.Risk == agent.Danger {
						st.confirming = m.ID
					} else {
						s.setMode(x.ID, m.ID)
						st.open = false
					}
				}
			}
			ui.Text(c, locales.SessionRules()).Bold().TextColor(t.Text).Padding(8, 0, 0)
			if len(x.Rules) == 0 {
				ui.Text(c, locales.None()).FontSize(12).TextColor(t.TextMuted)
			}
			for i, r := range x.Rules {
				s.ruleRow(c, x.ID, i, r)
			}
			if len(x.Rules) > 0 {
				ui.Text(c, locales.RevokeNote()).FontSize(11).TextColor(t.TextMuted)
			}
			if len(x.ReadDirs) > 0 {
				ui.Text(c, locales.DetailReadDirs()).Bold().TextColor(t.Text).Padding(8, 0, 0)
				for i, d := range x.ReadDirs {
					ui.Text(c, locales.ReadOnlyDir(d)).Key(i).Font("Menlo").FontSize(11).TextColor(t.Text)
				}
				ui.Text(c, locales.ReadDirsNote()).FontSize(11).TextColor(t.TextMuted)
			}
		})
	})
}

// modeRow is a mode to choose, under the Agent's own name, grayed with
// why when it cannot be chosen; it reports a click on one that can.
func (s *Shell) modeRow(c *ui.Context, kind agent.Kind, m agent.PermissionMode, current bool) bool {
	t := c.Theme()
	children := func() {
		symbol := "circle"
		if current {
			symbol = "checkmark.circle.fill"
		}
		icon(c, symbol).Size(14).Color(t.Accent)
		ui.Column(c).Grow(1).Children(func() {
			ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
				name := ui.Text(c, m.Name).TextColor(t.Text)
				if m.Risk == agent.Danger {
					name.TextColor(t.Warning)
				}
				if m.Default {
					ui.Text(c, locales.ModeDefault()).FontSize(11).TextColor(t.TextMuted)
				}
			})
			ui.Text(c, modeDescription(kind, m)).FontSize(11).TextColor(t.TextMuted)
			if m.Unavailable != "" {
				ui.Text(c, modeUnavailable(kind, m)).FontSize(11).TextColor(t.Warning)
			}
		})
	}
	if m.Unavailable != "" {
		ui.Row(c).Key(m.ID).Gap(8).Padding(6, 8).AlignItems(ui.Center).Opacity(0.5).Children(children)
		return false
	}
	return pickRow(c, m.ID, m.Name, children).Clicked()
}

// modeConfirm asks again before the dangerous mode *confirming, and
// reports whether the user went on.
func (s *Shell) modeConfirm(c *ui.Context, x model.Session, confirming *string) bool {
	if *confirming == "" {
		return false
	}
	t := c.Theme()
	m := agent.PermissionMode{ID: *confirming, Name: *confirming}
	for _, l := range s.modesOf(x.Agent) {
		if l.ID == *confirming {
			m = l
		}
	}
	ui.Text(c, locales.ModeConfirm(m.Name, modeDescription(x.Agent, m))).FontSize(12).TextColor(t.Text)
	done := false
	ui.Row(c).Gap(6).Children(func() {
		if ui.PrimaryButton(c, locales.ModeSwitch(m.Name)).Clicked() {
			s.setMode(x.ID, m.ID)
			*confirming, done = "", true
		}
		if ui.Button(c, locales.Cancel()).Clicked() {
			*confirming = ""
		}
	})
	return done
}

func (s *Shell) setMode(id, mode string) {
	if err := s.wb.SetMode(id, mode); err != nil {
		s.notice = s.failed(locales.ModeFailed, err)
	}
}

// ruleRow is a rule the session allows, in one line however long, its
// middle cut and the whole of it on hover, with its revoke button always
// in sight.
func (s *Shell) ruleRow(c *ui.Context, sessionID string, i int, r agent.Rule) {
	t := c.Theme()
	ui.Row(c).Key(i).Gap(6).AlignItems(ui.Center).MinWidth(0).Children(func() {
		label := ruleText(r)
		ui.Text(c, label).FontSize(12).TextColor(t.Text).MaxLines(1).TruncateMiddle().Tooltip(oneLine(label, 300)).Grow(1).Shrink(1).MinWidth(0)
		if ui.Button(c, locales.Revoke()).Label(locales.RevokeRule(oneLine(label, 200))).Shrink(0).Clicked() {
			if err := s.wb.RevokeRule(sessionID, i); err != nil {
				s.notice = s.say(err)
			}
		}
	})
}

// ruleText says what a rule allows: what rules kept before agent.Grant
// say as they are.
func ruleText(r agent.Rule) string {
	if r.Grant.Kind == "" {
		return r.Label
	}
	return grantText(r.Grant)
}

// grantText says what a grant allows.
func grantText(g agent.Grant) string {
	items := strings.Join(g.Items, locales.ListSep())
	switch g.Kind {
	case agent.GrantTools:
		return items
	case agent.GrantAcceptEdits:
		return locales.GrantAcceptEdits()
	case agent.GrantMode:
		return locales.GrantMode(items)
	case agent.GrantDirectories:
		return locales.GrantDirectories(items)
	case agent.GrantCommand:
		return locales.GrantCommand(items)
	case agent.GrantCommandPrefix:
		return locales.GrantCommandPrefix(strings.Join(g.Items, " "))
	case agent.GrantEdits:
		return locales.GrantEdits(items)
	}
	return strings.TrimSpace(string(g.Kind) + " " + items)
}

// modeTexts word the permission modes of the Agents aibo knows, by kind
// and ID; another's says what its adapter does, in English.
var modeTexts = map[agent.Kind]map[string]func() string{
	"claude": {
		"default":           locales.ClaudeModeDefault,
		"acceptEdits":       locales.ClaudeModeAcceptEdits,
		"plan":              locales.ClaudeModePlan,
		"auto":              locales.ClaudeModeAuto,
		"dontAsk":           locales.ClaudeModeDontAsk,
		"bypassPermissions": locales.ClaudeModeBypass,
	},
	"codex": {
		"read-only":        locales.CodexModeReadOnly,
		"ask-for-approval": locales.CodexModeAsk,
		"approve-for-me":   locales.CodexModeApprove,
		"full-access":      locales.CodexModeFull,
	},
}

// modeDescription says what a permission mode does.
func modeDescription(kind agent.Kind, m agent.PermissionMode) string {
	if say, ok := modeTexts[kind][m.ID]; ok {
		return say()
	}
	return m.Description
}

// modeUnavailable says why a permission mode cannot be chosen.
func modeUnavailable(kind agent.Kind, m agent.PermissionMode) string {
	if kind == "codex" && m.ID == "approve-for-me" {
		return locales.CodexReviewerOff()
	}
	return m.Unavailable
}
