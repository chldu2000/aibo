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

type acpConfig struct {
	ID         agent.Kind `json:"id"`
	Name       string     `json:"name"`
	Command    string     `json:"command"`
	Args       []string   `json:"args"`
	ToolPrefix *string    `json:"toolPrefix"`
}

var configID = regexp.MustCompile(`^[a-z][a-z0-9_-]*$`)

// Open adds the explicitly configured ACP instances from the aibo data
// directory. An instance ID is the durable Agent kind stored with sessions.
func Open(dir string, o Options) (*Registry, error) {
	r := New(o)
	path := filepath.Join(dir, "agents.json")
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return r, nil
	}
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var configs []acpConfig
	if err := dec.Decode(&configs); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if err := dec.Decode(new(any)); err != io.EOF || configs == nil {
		return nil, fmt.Errorf("%s: expected one JSON array", path)
	}
	for _, c := range configs {
		if !configID.MatchString(string(c.ID)) || strings.TrimSpace(c.Name) == "" || strings.TrimSpace(c.Command) == "" {
			return nil, fmt.Errorf("%s: invalid id, name or command for %q", path, c.ID)
		}
		if !filepath.IsAbs(c.Command) && (filepath.Base(c.Command) != c.Command || c.Command == "." || c.Command == "..") {
			return nil, fmt.Errorf("%s: command must be an executable name or absolute path for %q", path, c.ID)
		}
		if _, used := r.status[c.ID]; used || c.ID == "fake" {
			return nil, fmt.Errorf("%s: duplicate or reserved id %q", path, c.ID)
		}
		prefix := "aibo_"
		if c.ToolPrefix != nil {
			prefix = *c.ToolPrefix
		}
		spec := Spec{Kind: c.ID, Name: c.Name, Command: c.Command}
		r.specs = append(r.specs, spec)
		r.status[c.ID] = &Status{Spec: spec, State: Checking}
		r.acp[c.ID] = acp.New(c.ID, c.Name, "", c.Args, prefix)
	}
	return r, nil
}
