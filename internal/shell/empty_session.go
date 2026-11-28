package shell

import (
	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

// starterCommands is how many of the Agent's commands a new session
// offers to start with.
const starterCommands = 3

// emptySession stands for a session with no messages yet: who works and
// where, with which model and mode, and what to start with, each doing
// as the composer does. The model and the mode show as one line, apart
// from the composer's controls, which the Tester finds by their words.
func (s *Shell) emptySession(c *ui.Context, x model.Session, v *sessionView) {
	t := c.Theme()
	// What is known of the models, asking for none.
	var known []agent.Model
	if s.wb.TellsModels(x.Agent) {
		known = s.modelsOf(x.Agent, workbench.PeekModels).Models
	}
	in := modelInUse(x, s.wb.Status(x.ID), known)
	ui.Column(c).Margin(ui.Auto).Gap(8).AlignItems(ui.Center).MaxWidth(520).Children(func() {
		s.agentGlyph(c, x.Agent, 36)
		ui.Text(c, s.agentName(x.Agent)).Bold().FontSize(16).TextColor(t.Text)
		ui.Text(c, s.workspaceOf(x).Path).FontSize(12).TextColor(t.TextMuted).MaxLines(1).TruncateMiddle().MinWidth(0)
		ui.Text(c, in.name+" · "+s.modeOf(x).Name).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
		ui.Text(c, locales.StartConversation()).TextColor(t.TextMuted).Padding(8, 0, 4)
		ui.Row(c).Gap(6).Wrap().Justify(ui.Center).Children(func() {
			if opener(c, locales.StarterMention(), locales.StarterMention(), "").Clicked() {
				s.openPull(x.ID, -1)
				s.focusComposer = x.ID
			}
			if !s.wb.TellsCommands(x.Agent) {
				return
			}
			cmds := s.commandsOf(x, workbench.PeekCommands).Commands
			for _, cmd := range cmds[:min(len(cmds), starterCommands)] {
				c.Key(cmd.Name)
				if opener(c, "/"+cmd.Name, locales.StarterCommand(cmd.Name), cmd.Description).Clicked() {
					s.chooseCommand(v, cmd, v.draft)
					s.focusComposer = x.ID
				}
			}
		})
	})
}

// opener is one thing a new session offers to start with.
func opener(c *ui.Context, text, label, tip string) ui.Element {
	t := c.Theme()
	b := ui.Row(c).Padding(5, 10).Radius(9).BorderWidth(1).BorderColor(t.Border).Label(label).Cursor(ui.CursorPointer).Children(func() {
		ui.Text(c, text).FontSize(12).TextColor(t.Text).NoWrap()
	})
	if tip != "" {
		b.Tooltip(tip)
	}
	if b.Hovered() {
		b.Background(t.SurfaceHover)
	}
	return b
}
