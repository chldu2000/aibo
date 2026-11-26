package agents

import "github.com/chldu2000/aibo/internal/agent/acp"

// ModeTagsOf are the labels the adapter of c is given.
func ModeTagsOf(c ACPConfig) map[string]acp.ModeTag { return c.modeTags() }
