package shell

import (
	"regexp"
	"slices"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// The "/" panel: the Agent commands of a session's Agent, as it tells
// them, to invoke at the start of a message (ADR 0008). Chosen, or typed
// with a space after it, a command becomes the draft's chip.

// commandPanel is the "/" panel of the session in.
type commandPanel struct {
	open bool
	in   string
	// chosen is the match the arrow keys are on; shown are the matches
	// last shown, which the keys choose from between frames.
	chosen int
	shown  []agent.Command
	// moved is set when the keys moved the choice, which then comes
	// into view.
	moved bool
	// closed is set when the user closed it, until the draft no longer
	// starts with "/".
	closed bool
}

// commandsShown is how many matches the panel lists.
const commandsShown = 50

// matchCommands are the commands q names the start of, by name or alias,
// then those whose name or alias has q, each as the Agent orders them.
func matchCommands(cmds []agent.Command, q string) []agent.Command {
	q = strings.ToLower(q)
	var first, then []agent.Command
	for _, c := range cmds {
		names := append([]string{c.Name}, c.Aliases...)
		switch {
		case slices.ContainsFunc(names, func(n string) bool { return strings.HasPrefix(strings.ToLower(n), q) }):
			first = append(first, c)
		case slices.ContainsFunc(names, func(n string) bool { return strings.Contains(strings.ToLower(n), q) }):
			then = append(then, c)
		}
	}
	return append(first, then...)
}

// slashQuery is what the draft names of a command while the panel is to
// show: a "/" at its start, and no space yet.
func slashQuery(draft string) (string, bool) {
	q, ok := strings.CutPrefix(draft, "/")
	if !ok || strings.ContainsAny(q, " \t\n") {
		return "", false
	}
	return q, true
}

// typedCommand is "/name " at the start of a draft: the name and what
// follows the space after it.
var typedCommand = regexp.MustCompile(`^/(\S+)[ \t\n]`)

// commandsOf are the commands of session x, for the Agent's installation
// and sign-in as it is now.
func (s *Shell) commandsOf(x model.Session, demand workbench.CommandDemand) workbench.CommandList {
	var source workbench.ModelSource
	if r := s.opts.Agents; r != nil {
		st := r.Status(x.Agent)
		switch {
		case st.State == agents.Checking:
			return workbench.CommandList{Loading: true}
		case st.Problem == agents.ProblemUnknown:
			// Demo and test Agents are provided directly by the workbench.
		case !st.Usable():
			return workbench.CommandList{Err: &agents.UnusableError{Status: st}}
		default:
			source = workbench.ModelSource{Path: st.Path, Version: st.Version, Auth: st.Auth, SignedOut: st.State == agents.NotLoggedIn}
		}
	}
	return s.wb.CommandList(x.ID, source, demand)
}

// chooseCommand makes c the draft's command, in place of what named it.
func (s *Shell) chooseCommand(v *sessionView, c agent.Command, rest string) {
	v.command = &c
	v.draft, v.typed, v.caretEnd = rest, rest, true
	s.cmds = commandPanel{}
}

// commandKey handles the keys of the composer of session id that the
// panel or the chip take: the arrows, Enter and Tab choose; Escape
// closes; Backspace in an empty draft puts the chip back as words. It
// runs between frames.
func (s *Shell) commandKey(id string, v *sessionView, k ui.TextKey) bool {
	if k.Mods != 0 {
		return false
	}
	if k.Key == ui.KeyBackspace && v.command != nil && k.Text() == "" {
		name := "/" + v.command.Name
		v.command = nil
		s.cmds.closed = true
		k.SetText(name)
		v.typed, v.caretEnd = name, true
		return true
	}
	p := &s.cmds
	if !p.open || p.in != id || len(p.shown) == 0 {
		if p.open && p.in == id && k.Key == ui.KeyEscape {
			s.cmds = commandPanel{closed: true}
			return true
		}
		return false
	}
	switch k.Key {
	case ui.KeyDown:
		p.chosen, p.moved = min(p.chosen+1, len(p.shown)-1), true
	case ui.KeyUp:
		p.chosen, p.moved = max(p.chosen-1, 0), true
	case ui.KeyEnter, ui.KeyTab:
		c := p.shown[min(max(p.chosen, 0), len(p.shown)-1)]
		s.chooseCommand(v, c, "")
		k.SetText("")
	case ui.KeyEscape:
		s.cmds = commandPanel{closed: true}
	default:
		return false
	}
	return true
}

// draftCommand watches the draft of session x as the composer built it:
// "/name " with a command of that name becomes its chip, and "/" at the
// start opens the panel.
func (s *Shell) draftCommand(x model.Session, v *sessionView) {
	if v.command != nil || !s.wb.TellsCommands(x.Agent) {
		s.cmds.open = s.cmds.open && s.cmds.in != x.ID
		return
	}
	if m := typedCommand.FindStringSubmatch(v.draft); m != nil {
		cmds := s.commandsOf(x, workbench.PeekCommands).Commands
		if i := slices.IndexFunc(cmds, func(c agent.Command) bool { return c.Answers(m[1]) }); i >= 0 {
			s.chooseCommand(v, cmds[i], v.draft[len(m[0]):])
			s.focusComposer = x.ID
			return
		}
	}
	_, typing := slashQuery(v.draft)
	switch {
	case !typing:
		if s.cmds.in == x.ID || !s.cmds.open {
			s.cmds = commandPanel{}
		}
	case !s.cmds.open && !s.cmds.closed:
		// Asked for anew as it opens; what is known shows meanwhile.
		s.commandsOf(x, workbench.RefreshCommands)
		s.cmds = commandPanel{open: true, in: x.ID}
	}
}

// commandPanelView shows the "/" panel above the composer's card.
func (s *Shell) commandPanelView(c *ui.Context, x model.Session, v *sessionView, card ui.Element) {
	p := &s.cmds
	if !p.open || p.in != x.ID {
		return
	}
	q, _ := slashQuery(v.draft)
	list := s.commandsOf(x, workbench.LoadCommands)
	p.shown = matchCommands(list.Commands, q)
	if len(p.shown) > commandsShown {
		p.shown = p.shown[:commandsShown]
	}
	p.chosen = min(max(p.chosen, 0), max(len(p.shown)-1, 0))
	t := c.Theme()
	b := card.Bounds()
	room := max(0, b.Y-headerBottom-16)
	ui.PopoverBase(c, card, &p.open, func(panel ui.Element) {
		panel.AttachTo(card, ui.AnchorTopStart, ui.AnchorBottomStart).Margin(0, 0, 8, 0).
			Radius(16).Shadow(0, 5, 18, 0, ui.RGBA(0, 0, 0, 0.18))
		ui.Column(c).Width(b.W).MaxHeight(min(360, room)).Gap(4).Padding(10).Radius(16).Material(glass.Glass{}).Children(func() {
			ui.Text(c, locales.CommandsOf(s.agentName(x.Agent))).Bold().FontSize(13).TextColor(t.Text).Padding(2, 6)
			switch {
			case list.Err != nil && len(list.Commands) == 0:
				ui.Row(c).Gap(8).Padding(4, 6).AlignItems(ui.Center).Children(func() {
					ui.Text(c, withDetail(locales.CommandsFailed(), s.say(list.Err))).FontSize(12).TextColor(t.Warning).Grow(1).Shrink(1)
					if ui.Button(c, locales.Retry()).Clicked() {
						s.commandsOf(x, workbench.RefreshCommands)
					}
				})
			case len(list.Commands) == 0 && list.Loading:
				ui.Text(c, locales.CommandsLoading()).FontSize(12).TextColor(t.TextMuted).Padding(4, 6)
			case len(p.shown) == 0:
				ui.Text(c, locales.NoCommandsFound()).FontSize(12).TextColor(t.TextMuted).Padding(4, 6)
			}
			ui.Scroll(c).Shrink(1).MinHeight(0).Children(func() {
				ui.Column(c).Gap(2).Children(func() {
					for i, cmd := range p.shown {
						row := pickRow(c, "c"+cmd.Name, locales.UseCommand(cmd.Name), func() {
							ui.Column(c).Grow(1).Shrink(1).MinWidth(0).Children(func() {
								ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
									ui.Text(c, "/"+cmd.Name).Font("Menlo").FontSize(12).Bold().TextColor(t.Text).NoWrap()
									if cmd.ArgumentHint != "" {
										ui.Text(c, cmd.ArgumentHint).Font("Menlo").FontSize(11).TextColor(t.TextMuted).MaxLines(1).Shrink(1)
									}
									ui.Spacer(c)
									if cmd.Source != "" {
										ui.Text(c, cmd.Source).FontSize(11).TextColor(t.TextMuted).NoWrap()
									}
								})
								if cmd.Description != "" {
									ui.Text(c, cmd.Description).FontSize(11).TextColor(t.TextMuted).MaxLines(1)
								}
							})
						})
						if i == p.chosen {
							row.Background(t.SurfaceHover)
							if p.moved {
								row.ScrollIntoView()
							}
						}
						if row.Clicked() {
							s.chooseCommand(v, cmd, "")
							s.focusComposer = x.ID
						}
					}
				})
			})
		})
	})
	p.moved = false
	if !p.open {
		s.cmds = commandPanel{closed: true}
	}
}

// commandChip shows the draft's command, its description on hover.
func (s *Shell) commandChip(c *ui.Context, v *sessionView) {
	cmd := v.command
	if cmd == nil {
		return
	}
	t := c.Theme()
	ui.Row(c).Key("cmd").Gap(6).Padding(3, 4, 3, 8).Radius(8).AlignItems(ui.Center).BorderWidth(1).BorderColor(t.Accent).Tooltip(cmd.Description).Children(func() {
		ui.Text(c, "/"+cmd.Name).Font("Menlo").FontSize(12).Bold().TextColor(t.Accent)
		if iconButton(c, "xmark", locales.RemoveCommand(cmd.Name)).Clicked() {
			v.command = nil
		}
	})
}

// openControl opens the menu of the control a command given no choice
// names (workbench.PickError).
func (s *Shell) openControl(id string, control agent.Handling) {
	x, ok := s.wb.Session(id)
	if !ok {
		return
	}
	switch control {
	case agent.ByMode:
		s.modeMenu = modeState{open: true}
	case agent.ByEffort:
		s.modelsOf(x.Agent, workbench.LoadModels)
		s.modelMenu.models, s.modelMenu.efforts = false, true
	default:
		s.modelsOf(x.Agent, workbench.LoadModels)
		s.modelMenu = modelState{models: true, chosen: -1, reveal: true}
	}
}

// sentCommand shows the command a user message invoked, with what it
// was said to do as it was sent, and the words after it.
func sentCommand(c *ui.Context, m model.Message) {
	t := c.Theme()
	ui.Row(c).Gap(8).Padding(8, 12).Radius(12).Background(t.Surface).AlignItems(ui.Start).Children(func() {
		chip := ui.Row(c).Padding(1, 6).Radius(6).BorderWidth(1).BorderColor(t.Accent).Label(locales.SentCommand(m.Command.Name)).Children(func() {
			ui.Text(c, "/"+m.Command.Name).Font("Menlo").FontSize(12).Bold().TextColor(t.Accent).NoWrap()
		})
		if m.Command.Description != "" {
			chip.Tooltip(m.Command.Description)
		}
		if m.Text != "" {
			ui.Text(c, m.Text).Selectable().TextColor(t.Text).Grow(1).Shrink(1).MinWidth(0)
		}
	})
}

// commandOutput shows what an Agent command printed: not the model's
// words.
func commandOutput(c *ui.Context, m model.Message) {
	t := c.Theme()
	ui.Column(c).Gap(4).Padding(8, 12).Radius(10).BorderWidth(1).BorderColor(t.Border).Children(func() {
		ui.Text(c, locales.CommandOutput()).FontSize(11).Bold().TextColor(t.TextMuted)
		ui.Text(c, m.Text).Font("Menlo").FontSize(12).TextColor(t.TextMuted).Selectable()
	})
}
