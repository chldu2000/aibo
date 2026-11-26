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
	original                        *agents.ACPConfig
	removing                        bool
}

func editAgentForm(cfg agents.ACPConfig) *agentForm {
	f := &agentForm{original: &cfg, id: string(cfg.ID), name: cfg.Name, command: cfg.Command, args: strings.Join(cfg.Args, "\n")}
	if cfg.ToolPrefix != nil {
		f.prefix = *cfg.ToolPrefix
	} else if cfg.ID != agents.OpenCode {
		f.prefix = agents.DefaultToolPrefix
	}
	return f
}

func (s *Shell) addAgentForm(c *ui.Context, f *agentForm) {
	t := c.Theme()
	if f.removing {
		ui.Text(c, locales.ConfirmRemoveACP(f.name)).Bold().TextColor(t.Text)
		ui.Text(c, locales.RemoveACPDetails()).FontSize(12).TextColor(t.TextMuted)
		if f.err != "" {
			ui.Text(c, f.err).TextColor(t.Warning)
		}
		ui.Row(c).Gap(6).Children(func() {
			ui.Spacer(c)
			if ui.Button(c, locales.Cancel()).Disabled(f.saving).Clicked() {
				s.settings.addAgent = nil
			}
			if ui.Button(c, locales.ConfirmRemove()).Label(locales.ConfirmRemoveLabel()).TextColor(t.Danger).Disabled(f.saving).Clicked() {
				id := f.original.ID
				s.changeACP(f, id, func() (agent.Agent, error) { return nil, s.opts.Agents.RemoveACP(id) })
			}
		})
		return
	}
	if f.original != nil {
		ui.Text(c, locales.EditACPLabel(f.original.Name)).Bold().TextColor(t.Text)
	} else {
		ui.Text(c, locales.AddACPAgent()).Bold().TextColor(t.Text)
		ui.Text(c, locales.ACPRequirements()).FontSize(12).TextColor(t.TextMuted)
	}
	input := func(label string, value *string) ui.Element {
		return ui.TextInput(c, value).Label(locales.AgentFieldInput(label)).Grow(1).MinWidth(0).Disabled(f.saving)
	}
	field(c, locales.AgentDisplayName(), "", func() { input(locales.AgentDisplayName(), &f.name) })
	field(c, locales.AgentIdentifier(), "", func() {
		if f.original != nil {
			ui.Text(c, f.id).Selectable()
			return
		}
		input(locales.AgentIdentifier(), &f.id).Tooltip(locales.AgentIDHint())
	})
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
	field(c, locales.AgentToolPrefix(), "", func() {
		e := input(locales.AgentToolPrefix(), &f.prefix)
		if agent.Kind(f.id) == agents.OpenCode {
			e.Placeholder(locales.AutoToolPrefix())
		}
	})
	if f.err != "" {
		ui.Text(c, f.err).FontSize(12).TextColor(t.Warning)
	}
	// Cancel, then the primary action on the right, as the other settings
	// pages and dialogs do.
	ui.Row(c).Gap(6).Children(func() {
		ui.Spacer(c)
		if ui.Button(c, locales.Cancel()).Disabled(f.saving).Clicked() {
			s.settings.addAgent = nil
		}
		if ui.PrimaryButton(c, locales.Save()).Disabled(f.saving).Clicked() {
			s.saveAgent(f)
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
	if orig := f.original; orig != nil {
		cfg.ID = orig.ID
		cfg.Modes = orig.Modes // labelled in agents.json only
		if f.args == strings.Join(orig.Args, "\n") {
			cfg.Args = orig.Args
		}
		if cfg.ID == agents.OpenCode && prefix == "" && (orig.ToolPrefix == nil || *orig.ToolPrefix != "") {
			cfg.ToolPrefix = nil
		}
		if cfg.ID != agents.OpenCode && orig.ToolPrefix == nil && prefix == agents.DefaultToolPrefix {
			cfg.ToolPrefix = nil
		}
	}
	s.changeACP(f, cfg.ID, func() (agent.Agent, error) {
		if f.original != nil {
			return s.opts.Agents.EditACP(cfg)
		}
		return s.opts.Agents.AddACP(cfg)
	})
}

func (s *Shell) changeACP(f *agentForm, id agent.Kind, apply func() (agent.Agent, error)) {
	s.agentChangeBusy = true
	s.settings.agentErr = ""
	if f != nil {
		f.saving, f.err = true, ""
	}
	go func() {
		r := s.opts.Agents
		a, err := apply()
		if err == nil {
			if a == nil {
				s.wb.UnregisterAgent(id)
			} else {
				r.Check(context.Background(), id)
				s.wb.RegisterAgent(a)
			}
		}
		s.later(func() {
			s.agentChangeBusy = false
			if f != nil {
				f.saving = false
			}
			if err != nil {
				msg := s.failed(locales.SaveSettingsFailed, err)
				if f != nil && s.settings.addAgent == f {
					f.err = msg
				} else {
					s.settings.agentErr = msg
				}
				return
			}
			if s.settings.addAgent == f {
				s.settings.addAgent = nil
			}
		})
	}()
}
