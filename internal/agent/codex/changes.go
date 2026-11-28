package codex

import (
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
)

// fileChanges are a fileChange item's changes, one per file, each with its
// patch (codex-cli 0.172.0, testdata/edit-0.172.0.jsonl): an update's diff
// is its hunks, from "@@"; an add's or a delete's is the file's whole
// text, added or deleted. An update with a move_path moves the file.
func fileChanges(it item) []agent.FileChange {
	if it.Type != "fileChange" {
		return nil
	}
	var out []agent.FileChange
	for _, c := range it.Changes {
		ch := agent.FileChange{Path: c.Path}
		switch c.Kind.Type {
		case "add":
			ch.Kind, ch.Patch = agent.FileAdded, agent.PatchAdded(c.Path, c.Diff)
		case "delete":
			ch.Kind, ch.Patch = agent.FileDeleted, agent.PatchDeleted(c.Path, c.Diff)
		default:
			ch.Kind = agent.FileModified
			if c.Kind.MovePath != nil && *c.Kind.MovePath != "" {
				ch.Kind, ch.MovedTo = agent.FileMoved, *c.Kind.MovePath
			}
			if strings.TrimSpace(c.Diff) != "" {
				ch.Patch = agent.PatchHunks(c.Path, c.Diff)
			}
		}
		out = append(out, ch)
	}
	return out
}
