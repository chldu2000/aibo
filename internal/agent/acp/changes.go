package acp

import (
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
)

// cursorNoFile is the oldText the Cursor CLI (2026.11.22) tells of a file
// it creates, its newText beginning with a line "++ b/<path>" before the
// file's text (testdata/cursor-2026.11.22-edit.jsonl): a patch's headers,
// cut.
const cursorNoFile = "-- /dev/null"

// fileChanges are the files a tool call's diff contents tell, each with
// a patch worked out of its texts: ACP tells a file's text before and
// after, and no oldText for a file created. OpenCode (2.4.2) tells no diff
// of a file it creates, which then shows as before.
func fileChanges(t toolCall) []agent.FileChange {
	var out []agent.FileChange
	for _, c := range t.Content {
		if c.Type != "diff" || c.Path == "" {
			continue
		}
		ch := agent.FileChange{Path: c.Path, Kind: agent.FileAdded}
		switch {
		case c.OldText != nil && *c.OldText == cursorNoFile && strings.HasPrefix(c.NewText, "++ "):
			_, text, _ := strings.Cut(c.NewText, "\n")
			ch.Patch = agent.PatchAdded(c.Path, text)
		case c.OldText == nil:
			ch.Patch = agent.PatchAdded(c.Path, c.NewText)
		default:
			ch.Kind, ch.Patch = agent.FileModified, agent.PatchTexts(c.Path, *c.OldText, c.NewText)
		}
		out = append(out, ch)
	}
	return out
}
