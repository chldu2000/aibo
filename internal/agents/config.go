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
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/acp"
)

const OpenCode agent.Kind = "opencode"
const DefaultToolPrefix = "aibo_"

type ACPConfig struct {
	ID         agent.Kind `json:"id"`
	Name       string     `json:"name"`
	Command    string     `json:"command"`
	Args       []string   `json:"args,omitempty"`
	ToolPrefix *string    `json:"toolPrefix,omitempty"`
}

var configID = regexp.MustCompile(`^[a-z][a-z0-9_-]*$`)

var (
	ErrInvalidID      = errors.New("invalid Agent ID")
	ErrIDInUse        = errors.New("duplicate or reserved Agent ID")
	ErrMissingName    = errors.New("missing Agent name")
	ErrInvalidCommand = errors.New("expected an executable name or absolute path")
)

func (c ACPConfig) validate() error {
	if !configID.MatchString(string(c.ID)) {
		return ErrInvalidID
	}
	if _, ok := Describe(c.ID); ok || c.ID == "fake" {
		return ErrIDInUse
	}
	if strings.TrimSpace(c.Name) == "" {
		return ErrMissingName
	}
	if strings.TrimSpace(c.Command) == "" || (!filepath.IsAbs(c.Command) && (filepath.Base(c.Command) != c.Command || c.Command == "." || c.Command == "..")) {
		return ErrInvalidCommand
	}
	return nil
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
		r.registerACP(c)
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

// registerACP is called at startup or with the registry lock held.
func (r *Registry) registerACP(c ACPConfig) agent.Agent {
	prefix := DefaultToolPrefix
	if c.ToolPrefix != nil {
		prefix = *c.ToolPrefix
	}
	spec := Spec{Kind: c.ID, Name: c.Name, Command: c.Command}
	r.specs = append(r.specs, spec)
	r.status[c.ID] = &Status{Spec: spec, State: Checking}
	a := acp.New(c.ID, c.Name, "", c.Args, prefix)
	r.acp[c.ID] = a
	return a
}

// AddACP appends to the current file, preserving entries edited since Open.
// The adapter becomes visible only after the replacement file is in place.
func (r *Registry) AddACP(c ACPConfig) (agent.Agent, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	r.configMu.Lock()
	defer r.configMu.Unlock()
	if r.configPath == "" {
		return nil, errors.New("Agent registry has no data directory")
	}
	if r.Status(c.ID).Problem != ProblemUnknown {
		return nil, ErrIDInUse
	}
	configs, err := readConfigs(r.configPath)
	if err != nil {
		return nil, err
	}
	for _, existing := range configs {
		if existing.ID == c.ID {
			return nil, ErrIDInUse
		}
	}
	data, err := json.MarshalIndent(append(configs, c), "", "  ")
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
	return r.registerACP(c), nil
}
