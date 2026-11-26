package shell

import (
	"context"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

type agentForm struct {
	id, name, command, args, prefix string
	err                             string
	saving                          bool
}

func (s *Shell) addAgentForm(c *ui.Context, f *agentForm) {
	t := c.Theme()
	ui.Text(c, locales.AddACPAgent()).Bold().TextColor(t.Text)
	ui.Text(c, locales.ACPRequirements()).FontSize(12).TextColor(t.TextMuted)
	input := func(label string, value *string) ui.Element {
		return ui.TextInput(c, value).Label(locales.AgentFieldInput(label)).Grow(1).MinWidth(0).Disabled(f.saving)
	}
	field(c, locales.AgentDisplayName(), "", func() { input(locales.AgentDisplayName(), &f.name) })
	field(c, locales.AgentIdentifier(), "", func() { input(locales.AgentIdentifier(), &f.id).Tooltip(locales.AgentIDHint()) })
	ui.Text(c, locales.AgentCommand()).TextColor(t.Text)
	ui.Row(c).Gap(6).Children(func() {
		input(locales.AgentCommand(), &f.command).Placeholder(locales.AgentCommandHint())
		if s.opts.ChooseFile != nil && ui.Button(c, locales.BrowseExecutable()).Disabled(f.saving).Clicked() {
			go func() {
				if path, ok := s.opts.ChooseFile(); ok {
					s.later(func() {
						if !f.saving {
							f.command = path
						}
					})
				}
			}()
		}
	})
	ui.Text(c, locales.AgentArguments()).TextColor(t.Text)
	ui.TextArea(c, &f.args).Label(locales.AgentFieldInput(locales.AgentArguments())).Placeholder(locales.AgentArgumentsHint()).Height(70).Disabled(f.saving)
	field(c, locales.AgentToolPrefix(), "", func() { input(locales.AgentToolPrefix(), &f.prefix) })
	if f.err != "" {
		ui.Text(c, f.err).FontSize(12).TextColor(t.Warning)
	}
	ui.Row(c).Gap(8).Children(func() {
		if ui.PrimaryButton(c, locales.Save()).Disabled(f.saving).Clicked() {
			s.saveAgent(f)
		}
		if ui.Button(c, locales.Cancel()).Disabled(f.saving).Clicked() {
			s.settings.addAgent = nil
		}
	})
}

func (s *Shell) saveAgent(f *agentForm) {
	prefix := strings.TrimSpace(f.prefix)
	cfg := agents.ACPConfig{ID: agent.Kind(strings.TrimSpace(f.id)), Name: strings.TrimSpace(f.name), Command: strings.TrimSpace(f.command), ToolPrefix: &prefix}
	for _, arg := range strings.Split(strings.ReplaceAll(f.args, "\r\n", "\n"), "\n") {
		if arg != "" {
			cfg.Args = append(cfg.Args, arg)
		}
	}
	f.saving, f.err = true, ""
	go func() {
		r := s.opts.Agents
		a, err := r.AddACP(cfg)
		if err == nil {
			r.Check(context.Background(), cfg.ID)
			s.wb.RegisterAgent(a)
		}
		s.later(func() {
			f.saving = false
			if err != nil {
				f.err = s.failed(locales.SaveSettingsFailed, err)
				return
			}
			if s.settings.addAgent == f {
				s.settings.addAgent = nil
			}
		})
	}()
}
