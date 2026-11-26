package acp

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"os"
	"reflect"
	"slices"
	"sync"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
)

// The models, reasoning efforts and permission modes an ACP Agent offers.
// ACP tells them only within a session, and the efforts only for the model
// a session is on, so the Agent learns them: from a probe session, walked
// through every model and then deleted, when the Agent can delete
// sessions; and from every session it runs. A probe is not run for an
// Agent that cannot delete it, which would keep it in its history.

// errNoProbe: the Agent cannot delete a probe session.
var errNoProbe = errors.New("ACP agent cannot delete sessions")

type catalog struct {
	mu          sync.Mutex
	known       bool
	models      []agent.Model
	modes       []agent.PermissionMode
	defaultMode string
	// probe is closed when the probe ends; nil before one starts, and
	// again after one failed, for the next to try.
	probe    chan struct{}
	probeErr error
	noProbe  bool
	changed  func()
	// gen counts forget: a probe of an earlier program records nothing.
	gen int
	// tags label the modes, from the Agent's configuration.
	tags map[string]ModeTag
}

// OnListsChanged is called back after a session teaches the Agent other
// models or modes (agent.ListsChanger).
func (a *Agent) OnListsChanged(changed func()) {
	a.lists.mu.Lock()
	a.lists.changed = changed
	a.lists.mu.Unlock()
}

// TellsModels is false once the Agent is known to offer no model choice.
func (a *Agent) TellsModels() bool {
	a.lists.mu.Lock()
	defer a.lists.mu.Unlock()
	return !a.lists.known || len(a.lists.models) > 0
}

// Models are the models the Agent offers, in its order, each with the
// efforts it takes when known. The efforts are the Agent's own words,
// "default" included.
func (a *Agent) Models(ctx context.Context) ([]agent.Model, error) {
	if err := a.ready(ctx); err != nil {
		return nil, err
	}
	a.lists.mu.Lock()
	defer a.lists.mu.Unlock()
	out := slices.Clone(a.lists.models)
	for i := range out {
		out[i].Efforts = slices.Clone(out[i].Efforts)
	}
	return out, nil
}

// PermissionModes are the Agent's session modes. ACP tells no risk: the
// configuration's tags do (SetModeTags), and a mode without one is
// Caution, not read-only. Default is the one the tags name, else the mode
// of a new session.
func (a *Agent) PermissionModes(ctx context.Context) ([]agent.PermissionMode, error) {
	if err := a.ready(ctx); err != nil {
		return nil, err
	}
	a.lists.mu.Lock()
	defer a.lists.mu.Unlock()
	out := slices.Clone(a.lists.modes)
	def := a.lists.defaultMode
	if d := a.lists.configuredDefault(); d != "" && slices.ContainsFunc(out, func(m agent.PermissionMode) bool { return m.ID == d }) {
		def = d
	}
	for i := range out {
		if t, ok := a.lists.tags[out[i].ID]; ok {
			out[i].Risk, out[i].ReadOnly = t.Risk, t.ReadOnly
		}
		out[i].Default = out[i].ID == def
	}
	return out, nil
}

// ready waits for the lists, probing for them the first time.
func (a *Agent) ready(ctx context.Context) error {
	c := &a.lists
	c.mu.Lock()
	// A session may have told the lists first, without the efforts of
	// the models it was not on: the probe still runs, in the background.
	if c.probe == nil && !c.noProbe {
		done, gen := make(chan struct{}), c.gen
		c.probe = done
		go func() {
			err := a.probeLists(gen)
			c.mu.Lock()
			switch {
			case c.gen != gen:
				err = nil // for a program since replaced
			case errors.Is(err, errNoProbe):
				c.noProbe = true
			case err != nil && !c.known:
				c.probe, c.probeErr = nil, err // the next ask tries again
			}
			c.mu.Unlock()
			if err != nil && !errors.Is(err, errNoProbe) {
				a.mu.Lock()
				log := a.log
				a.mu.Unlock()
				log.Warn("ACP probe failed", "error", err)
			}
			close(done)
		}()
	}
	if c.known || c.noProbe {
		known := c.known
		c.mu.Unlock()
		if !known {
			return agent.ErrListsUnknown
		}
		return nil
	}
	done := c.probe
	c.mu.Unlock()
	select {
	case <-done:
	case <-ctx.Done():
		return ctx.Err()
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	switch {
	case c.known:
		return nil
	case c.probeErr != nil && !c.noProbe:
		return c.probeErr
	}
	return agent.ErrListsUnknown
}

// probeLists starts a session in an empty directory, without MCP, sets
// each model in turn for its efforts, and deletes the session.
func (a *Agent) probeLists(gen int) error {
	dir, err := os.MkdirTemp("", "aibo-acp-probe-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	s, err := a.launch(dir)
	if err != nil {
		return err
	}
	// Close ends the process before the directory goes.
	defer s.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	caps, err := s.handshake(ctx)
	if err != nil {
		return err
	}
	if caps.SessionCapabilities.Delete == nil {
		return errNoProbe
	}
	// One notice once the probe is done, rather than one per model.
	s.learn = func(opts []configOption, modes *legacyModes, fresh bool) {
		a.lists.mu.Lock()
		current := a.lists.gen == gen
		a.lists.mu.Unlock()
		if current {
			a.record(opts, modes, fresh, false)
		}
	}
	err = s.call(ctx, "session/new", object{"cwd": dir, "mcpServers": []object{}}, func(raw json.RawMessage) error {
		var info sessionInfo
		if err := json.Unmarshal(raw, &info); err != nil {
			return err
		}
		if info.SessionID == "" {
			return errors.New("ACP agent returned an empty sessionId")
		}
		s.id = info.SessionID
		s.configure(info.ConfigOptions, info.Modes, true)
		return nil
	})
	if err != nil {
		return err
	}
	s.mu.Lock()
	opts := s.options
	s.mu.Unlock()
	if o, ok := option(opts, categoryModel); ok {
		first := o.current()
		for _, c := range o.choices() {
			if c.Value == first {
				continue // configure saw its efforts
			}
			if err := s.setOption(ctx, o.ID, c.Value); err != nil {
				s.log.Debug("ACP probe could not set a model", "error", err)
			}
		}
	}
	if err := s.call(ctx, "session/delete", object{"sessionId": s.id}, nil); err != nil {
		s.log.Warn("ACP probe session not deleted", "error", err)
	}
	a.lists.mu.Lock()
	changed := a.lists.changed
	a.lists.mu.Unlock()
	if changed != nil {
		changed()
	}
	return nil
}

// forget drops the lists, for the next ask to probe again; a probe still
// running, of the program before, records nothing.
func (a *Agent) forget() {
	c := &a.lists
	c.mu.Lock()
	was := c.known
	changed := c.changed
	c.known, c.models, c.modes, c.defaultMode = false, nil, nil, ""
	c.probe, c.probeErr, c.noProbe = nil, nil, false
	c.gen++
	c.mu.Unlock()
	if was && changed != nil {
		changed()
	}
}

// learn keeps what a running session tells of the Agent's lists.
func (a *Agent) learn(opts []configOption, modes *legacyModes, fresh bool) {
	a.record(opts, modes, fresh, true)
}

// record merges what a session told: the model list as it is now, with
// the efforts of its current model; the efforts of others as known
// before. fresh is a new session, whose mode is the default.
func (a *Agent) record(opts []configOption, modes *legacyModes, fresh, notify bool) {
	c := &a.lists
	c.mu.Lock()
	before := struct {
		known       bool
		models      []agent.Model
		modes       []agent.PermissionMode
		defaultMode string
	}{c.known, c.models, c.modes, c.defaultMode}
	if o, ok := option(opts, categoryModel); ok {
		known := map[string][]string{}
		for _, m := range c.models {
			known[m.ID] = m.Efforts
		}
		current := o.current()
		e, hasEffort := option(opts, categoryEffort)
		var list []agent.Model
		for _, ch := range o.choices() {
			m := agent.Model{ID: ch.Value, Name: ch.Name, Description: ch.Description, Efforts: known[ch.Value]}
			if m.Name == "" {
				m.Name = m.ID
			}
			if ch.Value == current {
				m.Efforts = nil
				if hasEffort {
					for _, x := range e.choices() {
						m.Efforts = append(m.Efforts, x.Value)
					}
				}
			}
			if slices.Contains(m.Efforts, defaultEffort) {
				m.DefaultEffort = defaultEffort
			}
			list = append(list, m)
		}
		c.models = list
	}
	var current string
	if o, ok := option(opts, categoryMode); ok {
		c.modes, current = nil, o.current()
		for _, ch := range o.choices() {
			c.modes = append(c.modes, mode(ch.Value, ch.Name, ch.Description))
		}
	} else if modes != nil {
		c.modes, current = nil, modes.CurrentModeID
		for _, m := range modes.AvailableModes {
			c.modes = append(c.modes, mode(m.ID, m.Name, m.Description))
		}
	}
	if fresh && current != "" {
		c.defaultMode = current
	}
	c.known = true
	after := struct {
		known       bool
		models      []agent.Model
		modes       []agent.PermissionMode
		defaultMode string
	}{c.known, c.models, c.modes, c.defaultMode}
	changed := c.changed
	c.mu.Unlock()
	if notify && changed != nil && !reflect.DeepEqual(before, after) {
		changed()
	}
}

func mode(id, name, description string) agent.PermissionMode {
	if name == "" {
		name = id
	}
	return agent.PermissionMode{ID: id, Name: name, Description: description, Risk: agent.Caution}
}

// ModeTag is what the Agent's configuration says of one of its modes,
// which ACP does not tell: how risky it is, whether it changes no files,
// and whether it is the mode of a new session.
type ModeTag struct {
	Risk     agent.Risk
	ReadOnly bool
	Default  bool
}

// SetModeTags labels the Agent's modes by ID. A mode without a tag is
// Caution, not read-only.
func (a *Agent) SetModeTags(tags map[string]ModeTag) {
	a.lists.mu.Lock()
	defer a.lists.mu.Unlock()
	a.lists.tags = maps.Clone(tags)
}

// configuredDefault is the mode the configuration makes the default, if
// any.
func (c *catalog) configuredDefault() string {
	for id, t := range c.tags {
		if t.Default {
			return id
		}
	}
	return ""
}
