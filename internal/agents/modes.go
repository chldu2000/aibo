package agents

import (
	"errors"
	"maps"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/acp"
)

// ModeConfig labels one of an ACP Agent's modes, which ACP does not: how
// risky it is (risk "safe", "caution" or "danger"; omitted is caution),
// whether it changes no files, and whether it is the default of a new
// session.
type ModeConfig struct {
	Risk     string `json:"risk,omitempty"`
	ReadOnly bool   `json:"readOnly,omitempty"`
	Default  bool   `json:"default,omitempty"`
}

var (
	ErrInvalidRisk   = errors.New(`expected mode risk "safe", "caution" or "danger"`)
	ErrManyDefaults  = errors.New("more than one default mode")
	ErrEmptyModeName = errors.New("empty mode ID")
)

var risks = map[string]agent.Risk{"": agent.Caution, "safe": agent.Safe, "caution": agent.Caution, "danger": agent.Danger}

// openCodeModes label OpenCode's built-in agents: plan cannot edit, and
// build, the default, does what opencode.json permits. They apply while
// OpenCode's configuration labels no modes itself.
var openCodeModes = map[string]ModeConfig{
	"build": {Risk: "caution", Default: true},
	"plan":  {Risk: "safe", ReadOnly: true},
}

// cursorModes label the Cursor CLI's modes: agent, the default, has every
// tool, with approvals as the CLI's own configuration says; plan and ask
// edit nothing and run no commands, as the CLI describes them.
var cursorModes = map[string]ModeConfig{
	"agent": {Risk: "caution", Default: true},
	"plan":  {Risk: "safe", ReadOnly: true},
	"ask":   {Risk: "safe", ReadOnly: true},
}

func validateModes(modes map[string]ModeConfig) error {
	defaults := 0
	for id, m := range modes {
		if id == "" {
			return ErrEmptyModeName
		}
		if _, ok := risks[m.Risk]; !ok {
			return ErrInvalidRisk
		}
		if m.Default {
			defaults++
		}
	}
	if defaults > 1 {
		return ErrManyDefaults
	}
	return nil
}

// modeTags are the labels the adapter applies: the configuration's, or,
// for a built-in ACP Agent without any, the built-in ones.
func (c ACPConfig) modeTags() map[string]acp.ModeTag {
	modes := c.Modes
	if b, ok := builtin(c.ID); ok && modes == nil {
		modes = b.modes
	}
	tags := make(map[string]acp.ModeTag, len(modes))
	for id, m := range modes {
		tags[id] = acp.ModeTag{Risk: risks[m.Risk], ReadOnly: m.ReadOnly, Default: m.Default}
	}
	return tags
}

func cloneModes(modes map[string]ModeConfig) map[string]ModeConfig {
	return maps.Clone(modes)
}

func equalModes(a, b map[string]ModeConfig) bool {
	return maps.Equal(a, b)
}
