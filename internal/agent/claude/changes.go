package claude

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
)

// editResult is the tool_use_result of a call that changed a file: Edit's
// and MultiEdit's, Write's of a file created ("create") or replaced
// ("update"). Others' (Read's, a subagent's, an error's text) have no
// structuredPatch.
type editResult struct {
	Type     string `json:"type"`
	FilePath string `json:"filePath"`
	// Content is the text Write wrote.
	Content         string       `json:"content"`
	StructuredPatch *[]patchHunk `json:"structuredPatch"`
}

type patchHunk struct {
	OldStart int      `json:"oldStart"`
	OldLines int      `json:"oldLines"`
	NewStart int      `json:"newStart"`
	NewLines int      `json:"newLines"`
	Lines    []string `json:"lines"`
}

// changes are the files a call's tool_use_result says it changed, with
// the hunks Claude Code worked out, or none.
func changes(raw json.RawMessage) []agent.FileChange {
	var r editResult
	if len(raw) == 0 || raw[0] != '{' || json.Unmarshal(raw, &r) != nil || r.StructuredPatch == nil || r.FilePath == "" {
		return nil
	}
	ch := agent.FileChange{Path: r.FilePath, Kind: agent.FileModified}
	switch hunks := *r.StructuredPatch; {
	case r.Type == "create":
		// A new file has no hunks: its text is all added.
		ch.Kind, ch.Patch = agent.FileAdded, agent.PatchAdded(r.FilePath, r.Content)
	case len(hunks) > 0:
		var hs []string
		for _, h := range hunks {
			hs = append(hs, fmt.Sprintf("@@ -%d,%d +%d,%d @@\n%s", h.OldStart, h.OldLines, h.NewStart, h.NewLines, strings.Join(h.Lines, "\n")))
		}
		ch.Patch = agent.PatchHunks(r.FilePath, hs...)
	}
	return []agent.FileChange{ch}
}
