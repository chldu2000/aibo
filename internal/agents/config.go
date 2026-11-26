package agents

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/acp"
)

const OpenCode agent.Kind = "opencode"
const DefaultToolPrefix = "aibo_"

type ACPConfig struct {
	ID         agent.Kind `json:"id"`
	Name       string     `json:"name,omitempty"`
	Command    string     `json:"command,omitempty"`
	Args       []string   `json:"args,omitempty"`
	ToolPrefix *string    `json:"toolPrefix,omitempty"`
	// Modes label the Agent's modes by ID (ModeConfig); nil for OpenCode
	// is its built-in labels.
	Modes   map[string]ModeConfig `json:"modes,omitempty"`
	Removed bool                  `json:"removed,omitempty"`
}

var configID = regexp.MustCompile(`^[a-z][a-z0-9_-]*$`)

var (
	ErrInvalidID      = errors.New("invalid Agent ID")
	ErrIDInUse        = errors.New("duplicate or reserved Agent ID")
	ErrMissingName    = errors.New("missing Agent name")
	ErrInvalidCommand = errors.New("expected an executable name or absolute path")
	ErrConfigChanged  = errors.New("Agent configuration has changed")
)

func defaultOpenCode() ACPConfig {
	return ACPConfig{ID: OpenCode, Name: "OpenCode", Command: "opencode", Args: []string{"acp"}}
}

func (c ACPConfig) validate() error {
	if !configID.MatchString(string(c.ID)) {
		return ErrInvalidID
	}
	if _, ok := Describe(c.ID); ok && c.ID != OpenCode || c.ID == "fake" {
		return ErrIDInUse
	}
	if c.Removed {
		if c.ID != OpenCode {
			return ErrInvalidID
		}
		return nil
	}
	if strings.TrimSpace(c.Name) == "" {
		return ErrMissingName
	}
	if strings.TrimSpace(c.Command) == "" || (!filepath.IsAbs(c.Command) && (filepath.Base(c.Command) != c.Command || c.Command == "." || c.Command == "..")) {
		return ErrInvalidCommand
	}
	return validateModes(c.Modes)
}

// Open adds the explicitly configured ACP instances from the aibo data
// directory. An instance ID is the durable Agent kind stored with sessions.
func Open(dir string, o Options) (*Registry, error) {
	r := New(o)
	r.configPath = filepath.Join(dir, "agents.json")
	configs, err := readConfigs(r.configPath)
	if err != nil {
		return nil, err
	}
	for _, c := range configs {
		r.applyACP(c)
	}
	return r, nil
}

func readConfigs(path string) ([]ACPConfig, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var configs []ACPConfig
	if err := dec.Decode(&configs); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if err := dec.Decode(new(any)); err != io.EOF || configs == nil {
		return nil, fmt.Errorf("%s: expected one JSON array", path)
	}
	seen := make(map[agent.Kind]bool)
	for _, c := range configs {
		if err := c.validate(); err != nil {
			return nil, fmt.Errorf("%s (%q): %w", path, c.ID, err)
		}
		if seen[c.ID] {
			return nil, fmt.Errorf("%s (%q): %w", path, c.ID, ErrIDInUse)
		}
		seen[c.ID] = true
	}
	return configs, nil
}

// ACPConfig returns the editable launch configuration, including implicit defaults.
func (r *Registry) ACPConfig(id agent.Kind) (ACPConfig, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.configs[id]
	c.Args = slices.Clone(c.Args)
	c.Modes = cloneModes(c.Modes)
	if c.ToolPrefix != nil {
		p := *c.ToolPrefix
		c.ToolPrefix = &p
	}
	return c, ok
}

// applyACP is called at startup or with the registry lock held.
func (r *Registry) applyACP(c ACPConfig) agent.Agent {
	i := slices.IndexFunc(r.specs, func(s Spec) bool { return s.Kind == c.ID })
	if c.Removed {
		if i >= 0 {
			r.specs = slices.Delete(r.specs, i, i+1)
		}
		delete(r.configs, c.ID)
		delete(r.acp, c.ID)
		delete(r.status, c.ID)
		delete(r.paths, c.ID)
		return nil
	}
	prefix := DefaultToolPrefix
	if c.ToolPrefix != nil {
		prefix = *c.ToolPrefix
	}
	spec := Spec{Kind: c.ID, Name: c.Name, Command: c.Command}
	if c.ID == OpenCode {
		builtin, _ := Describe(OpenCode)
		spec.InstallURL = builtin.InstallURL
		base := filepath.Base(c.Command)
		if strings.EqualFold(base, "opencode") || strings.EqualFold(base, "opencode.exe") {
			spec.MinVersion = builtin.MinVersion
		}
	}
	if i >= 0 {
		r.specs[i] = spec
	} else {
		r.specs = append(r.specs, spec)
	}
	c.Args = slices.Clone(c.Args)
	if c.ToolPrefix != nil {
		p := *c.ToolPrefix
		c.ToolPrefix = &p
	}
	c.Modes = cloneModes(c.Modes)
	r.configs[c.ID] = c
	r.status[c.ID] = &Status{Spec: spec, State: Checking}
	a := acp.New(c.ID, c.Name, "", c.Args, prefix)
	a.SetModeTags(c.modeTags())
	r.acp[c.ID] = a
	return a
}

// AddACP appends to the current file, preserving entries edited since Open.
// The adapter becomes visible only after the replacement file is in place.
func (r *Registry) AddACP(c ACPConfig) (agent.Agent, error) {
	if c.ID == OpenCode || c.Removed {
		return nil, ErrIDInUse
	}
	return r.saveACP(c, true)
}

func (r *Registry) EditACP(c ACPConfig) (agent.Agent, error) {
	if c.Removed {
		return nil, ErrInvalidID
	}
	return r.saveACP(c, false)
}

func (r *Registry) RemoveACP(id agent.Kind) error {
	_, err := r.saveACP(ACPConfig{ID: id, Removed: true}, false)
	return err
}

func (r *Registry) RestoreOpenCode() (agent.Agent, error) {
	return r.saveACP(defaultOpenCode(), true)
}

func (r *Registry) saveACP(c ACPConfig, add bool) (agent.Agent, error) {
	if !c.Removed {
		if err := c.validate(); err != nil {
			return nil, err
		}
	}
	r.configMu.Lock()
	defer r.configMu.Unlock()
	if r.configPath == "" {
		return nil, errors.New("Agent registry has no data directory")
	}
	current, exists := r.ACPConfig(c.ID)
	if add && exists {
		return nil, ErrIDInUse
	}
	if !add && !exists {
		return nil, ErrConfigChanged
	}
	configs, err := readConfigs(r.configPath)
	if err != nil {
		return nil, err
	}
	index := slices.IndexFunc(configs, func(d ACPConfig) bool { return d.ID == c.ID })
	if index >= 0 && add && !configs[index].Removed {
		return nil, ErrIDInUse
	}
	var disk ACPConfig
	if index >= 0 {
		disk = configs[index]
	} else if c.ID == OpenCode {
		disk = defaultOpenCode()
	}
	if !add && !current.equal(disk) || add && c.ID == OpenCode && !disk.Removed {
		return nil, ErrConfigChanged
	}
	switch {
	case c.Removed && c.ID != OpenCode:
		configs = slices.Delete(configs, index, index+1)
	case index >= 0:
		configs[index] = c
	default:
		configs = append(configs, c)
	}
	data, err := json.MarshalIndent(configs, "", "  ")
	if err != nil {
		return nil, err
	}
	tmp, err := os.CreateTemp(filepath.Dir(r.configPath), ".agents-*.tmp")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp.Name())
	_, err = tmp.Write(append(data, '\n'))
	closeErr := tmp.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if err := os.Rename(tmp.Name(), r.configPath); err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.applyACP(c), nil
}

func (c ACPConfig) equal(other ACPConfig) bool {
	p, q := c.ToolPrefix, other.ToolPrefix
	return c.ID == other.ID && c.Name == other.Name && c.Command == other.Command &&
		c.Removed == other.Removed && slices.Equal(c.Args, other.Args) &&
		(p == q || p != nil && q != nil && *p == *q) && equalModes(c.Modes, other.Modes)
}
