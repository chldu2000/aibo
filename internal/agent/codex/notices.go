package codex

import (
	"encoding/json"

	"github.com/chldu2000/aibo/internal/agent"
)

// The app-server's notifications the adapter knows: those it handles
// (thread.handle, account/*), and those it ignores, each for a reason.
// Any other goes to the diagnostic log as unknown.
var knownNotices = map[string]bool{
	// thread.handle
	"thread/settings/updated": true, "item/agentMessage/delta": true,
	"item/reasoning/summaryTextDelta": true, "item/reasoning/textDelta": true,
	"item/started": true, "item/completed": true, "turn/plan/updated": true,
	"error": true, "turn/completed": true,
	// What item/completed says whole: outputs, patches, plans.
	"item/commandExecution/outputDelta": true, "item/fileChange/outputDelta": true,
	"item/fileChange/patchUpdated": true, "item/plan/delta": true,
	"item/reasoning/summaryPartAdded": true, "item/mcpToolCall/progress": true,
	"turn/diff/updated": true,
	// A compaction comes as a contextCompaction item.
	"thread/compacted": true,
	// What a turn and its thread go through, which the call's result or
	// turn/completed tell already.
	"thread/started": true, "thread/status/changed": true, "thread/readState/changed": true,
	"thread/name/updated": true, "turn/started": true, "turn/moderationMetadata": true,
	"thread/tokenUsage/updated": true, "serverRequest/resolved": true,
	// The app-server's own state, which aibo does not show.
	"mcpServer/startupStatus/updated": true, "remoteControl/status/changed": true,
	"skills/changed": true, "app/list/updated": true,
}

// warnings are Codex's own warnings, logged with what they say.
var warnings = map[string]bool{"warning": true, "configWarning": true, "deprecationNotice": true, "guardianWarning": true}

// logNotice writes a notification to the diagnostic log, if it is a
// warning or the adapter does not know it: an unknown one once, as its
// method and its fields' names.
func (s *server) logNotice(method string, params json.RawMessage) {
	switch {
	case warnings[method]:
		var w struct {
			Message string `json:"message"`
			Summary string `json:"summary"`
		}
		json.Unmarshal(params, &w)
		s.log.Warn("codex warning", "method", method, "message", firstNonEmpty(w.Message, w.Summary))
	case knownNotices[method] || len(method) > 8 && method[:8] == "account/":
	default:
		s.mu.Lock()
		seen := s.unknown[method]
		if s.unknown == nil {
			s.unknown = map[string]bool{}
		}
		s.unknown[method] = true
		s.mu.Unlock()
		if !seen {
			s.log.Warn("unknown notification", "method", method, "fields", agent.Shape(params))
		}
	}
}

func firstNonEmpty(xs ...string) string {
	for _, x := range xs {
		if x != "" {
			return x
		}
	}
	return ""
}
