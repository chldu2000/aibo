package acp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/chldu2000/aibo/internal/agent"
)

// ACP session settings: the model, the reasoning effort and the session
// mode. Agents report them as configOptions, found by category (model,
// thought_level, mode); older Agents report only the mode, as modes with
// session/set_mode. Each set_config_option answers with the whole list,
// since one choice can change the others: OpenCode offers an effort only
// for some models, and a new model starts again at its default.

const (
	categoryModel  = "model"
	categoryEffort = "thought_level"
	categoryMode   = "mode"
	// defaultEffort is the effort value meaning the Agent's own default,
	// as OpenCode names it; aibo's is empty.
	defaultEffort = "default"
)

type configOption struct {
	ID, Name, Category, Type string
	CurrentValue             json.RawMessage
	Options                  json.RawMessage
}

// choice is one value a select option takes.
type choice struct {
	Value, Name, Description string
}

// current is the option's value, when it is a string.
func (o configOption) current() string {
	var v string
	json.Unmarshal(o.CurrentValue, &v)
	return v
}

// choices are the option's values, groups flattened.
func (o configOption) choices() []choice {
	var items []struct {
		Value, Name, Description string
		Options                  []choice
	}
	json.Unmarshal(o.Options, &items)
	var out []choice
	for _, it := range items {
		if it.Options != nil {
			out = append(out, it.Options...)
		} else if it.Value != "" {
			out = append(out, choice{it.Value, it.Name, it.Description})
		}
	}
	return out
}

func (o configOption) offers(value string) bool {
	for _, c := range o.choices() {
		if c.Value == value {
			return true
		}
	}
	return false
}

// legacyModes is session/new's modes, for an Agent without a mode
// option.
type legacyModes struct {
	CurrentModeID  string
	AvailableModes []struct{ ID, Name, Description string }
}

// option finds the option of a category, or else the one of that ID.
func option(opts []configOption, category string) (configOption, bool) {
	for _, o := range opts {
		if o.Category == category {
			return o, true
		}
	}
	for _, o := range opts {
		if o.Category == "" && o.ID == category {
			return o, true
		}
	}
	return configOption{}, false
}

// effortOption is the reasoning effort. An Agent can file more than one
// option under thought_level: the Cursor CLI puts a boolean thinking
// switch (true/false) ahead of the effort. The effort is the one whose
// values are not only true and false. With no such option, Cursor's Auto
// offers optimize_for (intelligence, balanced, cost) under model_config,
// and that is the menu. Context and fast stay out of it.
func effortOption(opts []configOption) (configOption, bool) {
	var toggle configOption
	var sawToggle bool
	for _, o := range opts {
		if o.Category != categoryEffort && !(o.Category == "" && o.ID == categoryEffort) {
			continue
		}
		if booleanChoices(o) {
			if !sawToggle {
				toggle, sawToggle = o, true
			}
			continue
		}
		return o, true
	}
	for _, o := range opts {
		if o.ID == "optimize_for" {
			return o, true
		}
	}
	return toggle, sawToggle
}

// booleanChoices reports a true/false switch, as Cursor's thinking option.
func booleanChoices(o configOption) bool {
	cs := o.choices()
	if len(cs) == 0 {
		return false
	}
	for _, c := range cs {
		if c.Value != "true" && c.Value != "false" {
			return false
		}
	}
	return true
}

// configure keeps what a session reported as it started, and its
// defaults: what empty asks for later. fresh is a new session, whose
// settings are the Agent's defaults.
func (s *session) configure(opts []configOption, modes *legacyModes, fresh bool) {
	s.mu.Lock()
	s.options, s.modes = opts, modes
	if o, ok := option(opts, categoryModel); ok {
		s.defaultModel = o.current()
	}
	if o, ok := option(opts, categoryMode); ok {
		s.defaultMode = o.current()
	} else if modes != nil {
		s.defaultMode = modes.CurrentModeID
	}
	if p := s.preferMode; p != "" {
		o, ok := option(opts, categoryMode)
		if ok && o.offers(p) || !ok && modes != nil && slices.ContainsFunc(modes.AvailableModes, func(m struct{ ID, Name, Description string }) bool { return m.ID == p }) {
			s.defaultMode = p
		}
	}
	var seen *legacyModes
	if modes != nil {
		c := *modes
		seen = &c
	}
	s.mu.Unlock()
	if s.learn != nil {
		s.learn(opts, seen, fresh)
	}
}

// replace keeps the whole list an Agent answered with, or pushed.
func (s *session) replace(opts []configOption) {
	if opts == nil {
		return
	}
	s.mu.Lock()
	s.options = opts
	s.mu.Unlock()
	if s.learn != nil {
		s.learn(opts, nil, false)
	}
}

// report says what the session uses now: SettingsReported when the
// Agent tells its model or effort, ModeReported when it tells its mode.
// The effort is the Agent's own word, "default" too, as the effort menu
// lists it (Agent.Models).
func (s *session) report() {
	s.mu.Lock()
	opts, legacy := s.options, s.modes != nil
	var legacyMode string
	if legacy {
		legacyMode = s.modes.CurrentModeID
	}
	s.mu.Unlock()
	model, hasModel := option(opts, categoryModel)
	effort, hasEffort := effortOption(opts)
	if hasModel || hasEffort {
		s.emit(agent.SettingsReported{Model: model.current(), Effort: effort.current()})
	}
	if mode, ok := option(opts, categoryMode); ok {
		s.emit(agent.ModeReported{ID: mode.current()})
	} else if legacy {
		s.emit(agent.ModeReported{ID: legacyMode})
	}
}

func (s *session) setOption(ctx context.Context, id, value string) error {
	return s.call(ctx, "session/set_config_option", object{"sessionId": s.id, "configId": id, "value": value}, func(raw json.RawMessage) error {
		var info sessionInfo
		if err := json.Unmarshal(raw, &info); err != nil {
			return err
		}
		s.replace(info.ConfigOptions)
		return nil
	})
}

func (s *session) SetModel(ctx context.Context, model, effort string) error {
	s.mu.Lock()
	busy := s.active != 0
	s.mu.Unlock()
	if busy {
		return agent.ErrBusy
	}
	err := s.setModel(ctx, model, effort)
	s.report()
	return err
}

// setModel sets the model, then the effort: the choice of efforts is the
// new model's.
func (s *session) setModel(ctx context.Context, model, effort string) error {
	s.mu.Lock()
	opts := s.options
	if model == "" {
		model = s.defaultModel
	}
	s.mu.Unlock()
	if o, ok := option(opts, categoryModel); ok && model != "" && model != o.current() {
		if err := s.setOption(ctx, o.ID, model); err != nil {
			return err
		}
	} else if !ok && model != "" {
		return errors.New("ACP agent does not expose a model selection")
	}
	s.mu.Lock()
	opts = s.options
	s.mu.Unlock()
	o, ok := effortOption(opts)
	if !ok {
		if effort != "" {
			return fmt.Errorf("ACP agent offers no reasoning effort for model %q", model)
		}
		return nil
	}
	if effort == "" {
		if !o.offers(defaultEffort) {
			return nil // the Agent has no way back to its default
		}
		effort = defaultEffort
	}
	if effort == o.current() {
		return nil
	}
	return s.setOption(ctx, o.ID, effort)
}

func (s *session) SetMode(ctx context.Context, mode string) error {
	err := s.setMode(ctx, mode)
	s.report()
	return err
}

func (s *session) setMode(ctx context.Context, mode string) error {
	s.mu.Lock()
	opts, legacy := s.options, s.modes != nil
	var legacyMode string
	if legacy {
		legacyMode = s.modes.CurrentModeID
	}
	if mode == "" {
		mode = s.defaultMode
	}
	s.mu.Unlock()
	if o, ok := option(opts, categoryMode); ok {
		if mode == "" || mode == o.current() {
			return nil
		}
		return s.setOption(ctx, o.ID, mode)
	}
	if !legacy {
		if mode == "" {
			return nil
		}
		return errors.New("ACP agent does not expose session modes")
	}
	if mode == "" || mode == legacyMode {
		return nil
	}
	return s.call(ctx, "session/set_mode", object{"sessionId": s.id, "modeId": mode}, func(json.RawMessage) error {
		s.mu.Lock()
		if s.modes != nil {
			s.modes.CurrentModeID = mode
		}
		s.mu.Unlock()
		return nil
	})
}

// modeChanged follows current_mode_update, from an Agent with modes.
func (s *session) modeChanged(id string) {
	s.mu.Lock()
	known := s.modes != nil
	if known {
		s.modes.CurrentModeID = id
	}
	s.mu.Unlock()
	if known {
		s.report()
	}
}
