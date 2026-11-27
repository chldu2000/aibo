package codex

import (
	"context"
	"fmt"
	"maps"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
)

// What a turn and a thread start with: the input, and the settings.

// settings are what a session was set to: its preset, model and effort,
// empty for those never set.
type settings struct{ mode, model, effort string }

// threadParams are thread/start's for a new thread in the session's
// settings. Called with s.mu held.
func (s *session) threadParams() map[string]any {
	params := maps.Clone(s.start)
	if p, ok := presetOf(s.current.mode); ok {
		params["sandbox"], params["approvalPolicy"], params["approvalsReviewer"] = p.sandbox, p.policy, p.reviewer
	}
	if s.current.model != "" {
		params["model"] = s.current.model
	}
	// What was to apply from the next turn applies to the new thread's.
	s.mode, s.model = "", ""
	return params
}

// turnInput is turn/start's input: an image Codex reads itself from its
// path (localImage, research/17) before the text, for each image.
func turnInput(text string, images []agent.Image) []any {
	var in []any
	for _, img := range images {
		in = append(in, map[string]any{"type": "localImage", "path": img.Path})
	}
	if text != "" || len(images) == 0 {
		in = append(in, map[string]any{"type": "text", "text": text})
	}
	return in
}

// withFiles is text with the files the user mentioned after it: Codex
// takes no file as input (a "mention" item shows the model nothing,
// research/07), so it reads them itself.
func withFiles(text string, files []agent.FileMention) string {
	if len(files) == 0 {
		return text
	}
	var b strings.Builder
	b.WriteString(text)
	b.WriteString("\n\n" + filesHeading)
	for _, f := range files {
		b.WriteString("\n- " + f.Name())
		if f.Dir {
			b.WriteString(dirMark)
		}
	}
	return strings.TrimSpace(b.String())
}

// turnParams are turn/start's for text and images, with what changed
// since the last turn, which Codex keeps from then on. Called with s.mu
// held.
func (s *session) turnParams(text string, images []agent.Image) map[string]any {
	params := map[string]any{"threadId": s.id, "input": turnInput(text, images)}
	if p, ok := presetOf(s.mode); ok {
		params["approvalPolicy"], params["approvalsReviewer"] = p.policy, p.reviewer
		params["sandboxPolicy"] = map[string]any{"type": sandboxTypes[p.sandbox]}
		s.mode = ""
	}
	if s.model != "" {
		params["model"], s.model = s.model, ""
	}
	if s.effort != "" {
		params["effort"], s.effort = s.effort, ""
	}
	return params
}

// SetModel applies a model and an effort from the next turn, as SetMode
// does; Codex then reports them (thread/settings/updated). Empty ones
// leave what the thread uses: Codex's own cannot be asked for by name.
func (s *session) SetModel(_ context.Context, model, effort string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.model, s.effort = model, effort
	s.current.model, s.current.effort = model, effort
	return nil
}

// SetMode applies a preset from the next turn: Codex takes its settings
// with turn/start, and reports them (thread/settings/updated).
func (s *session) SetMode(_ context.Context, mode string) error {
	if _, ok := presetOf(mode); !ok {
		return fmt.Errorf("no such permission mode: %s", mode)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mode, s.current.mode = mode, mode
	return nil
}
