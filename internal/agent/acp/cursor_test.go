package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
)

// What the Cursor CLI 2026.11.22 answered with its parameterized model
// picker, while its model, effort and mode changed: each model's effort
// has an ID of its own, only its category says what it is, and there is
// no default effort. Its Context and Fast options (category model_config)
// are not aibo's.
func TestCursorSettingsCapture(t *testing.T) {
	f, err := os.Open("testdata/cursor-2026.11.22-settings.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	want := [][]string{
		// Switching between models.
		{"model=default", "effort=", "mode=agent"}, // session/new, on Auto
		{"model=grok-4.7", "effort=high", "mode=agent"},
		{"model=claude-opus-5-5", "effort=medium", "mode=agent"},
		{"model=gpt-5.6-sol", "effort=medium", "mode=agent"},
		{"model=composer-2.5", "effort=", "mode=agent"}, // Fast only
		{"model=default", "effort=", "mode=agent"},
		// Setting the effort and the mode.
		{"model=default", "effort=", "mode=agent"},
		{"model=claude-opus-5-5", "effort=medium", "mode=agent"},
		{"model=claude-opus-5-5", "effort=high", "mode=agent"},
		{"model=grok-4.7", "effort=high", "mode=agent"},
		{"model=claude-opus-5-5", "effort=high", "mode=agent"}, // kept its own effort
		{"model=claude-opus-5-5", "effort=high", "mode=plan"},
		{"model=grok-4.7", "effort=high", "mode=agent"}, // a new process starts on the last choice
	}
	a := New(agent.Kind("cursor"), "Cursor", "", nil, "")
	s := &session{events: make(chan agent.Event, 8), log: agent.Discard, learn: a.learn}
	var got [][]string
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		var line struct {
			Dir   string
			Frame envelope
		}
		if err := json.Unmarshal(sc.Bytes(), &line); err != nil {
			t.Fatal(err)
		}
		var info sessionInfo
		if line.Dir != "in" || line.Frame.Method != "" || json.Unmarshal(line.Frame.Result, &info) != nil || info.ConfigOptions == nil {
			continue
		}
		if info.SessionID != "" {
			s.configure(info.ConfigOptions, info.Modes, true)
		} else {
			s.replace(info.ConfigOptions)
		}
		s.report()
		got = append(got, settingsOf(s))
	}
	if !slices.EqualFunc(got, want, slices.Equal) {
		t.Fatalf("reports\n got %q\nwant %q", got, want)
	}
	if effort, _ := option(s.options, categoryEffort); effort.ID != "reasoning_effort" || effort.offers(defaultEffort) {
		t.Errorf("grok's effort = %+v", effort)
	}

	// The lists learned from the sessions: readable names, each model's
	// efforts as it offered them, none for Auto and Composer.
	ms, err := a.Models(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 49 {
		t.Fatalf("%d models", len(ms))
	}
	byID := map[string]agent.Model{}
	for _, m := range ms {
		byID[m.ID] = m
	}
	for id, w := range map[string]struct {
		name    string
		efforts []string
	}{
		"default":         {"Auto", nil},
		"grok-4.7":        {"Grok 4.7", []string{"low", "medium", "high", "xhigh"}},
		"claude-opus-5-5": {"Claude Opus 5.5", []string{"low", "medium", "high", "xhigh", "max"}},
		"gpt-5.6-sol":     {"GPT-5.6 Sol", []string{"none", "low", "medium", "high", "xhigh", "max"}},
		"composer-2.5":    {"Composer 2.5", nil},
	} {
		m := byID[id]
		if m.Name != w.name || !slices.Equal(m.Efforts, w.efforts) || m.DefaultEffort != "" {
			t.Errorf("%s = %+v", id, m)
		}
	}
	modes, err := a.PermissionModes(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if got := modesText(modes); !slices.Equal(got, []string{"agent:Agent:default", "plan:Plan", "ask:Ask"}) {
		t.Errorf("modes %q", got)
	}
}

// Every handshake tells the Agent what SetClientMeta says, the probe's
// too; without it, clientCapabilities is empty.
func TestClientMeta(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, meta := range []map[string]any{nil, {"parameterizedModelPicker": true}} {
		dir := t.TempDir()
		init := filepath.Join(dir, "init")
		a := New("x", "X", "", nil, "")
		a.Configure(exe, []string{"AIBO_ACP_FAKE=options", "AIBO_ACP_LOG=" + filepath.Join(dir, "log"), "AIBO_ACP_INIT=" + init})
		a.SetClientMeta(meta)
		caps := func() string {
			b, err := os.ReadFile(init)
			if err != nil {
				t.Fatal(err)
			}
			var req struct {
				Params struct{ ClientCapabilities json.RawMessage }
			}
			json.Unmarshal(b, &req)
			return string(req.Params.ClientCapabilities)
		}
		want := `{}`
		if meta != nil {
			want = `{"_meta":{"parameterizedModelPicker":true}}`
		}
		if _, err := a.Models(t.Context()); err != nil {
			t.Fatal(err)
		}
		if got := caps(); got != want {
			t.Errorf("the probe told %s, want %s", got, want)
		}
		os.Remove(init)
		s, err := a.Start(t.Context(), agent.StartOptions{Workspace: t.TempDir()})
		if err != nil {
			t.Fatal(err)
		}
		s.Close()
		if got := caps(); got != want {
			t.Errorf("a session told %s, want %s", got, want)
		}
	}
}

// An Agent that answers session/new with ACP's auth_required (-32000), as
// the Cursor CLI signed out does, did not start because it is signed out.
func TestSignedOutAtStart(t *testing.T) {
	a, _, _ := fakeACP(t, "options-nodelete-signedout")
	_, err := a.Start(t.Context(), agent.StartOptions{Workspace: t.TempDir()})
	if !errors.Is(err, agent.ErrNotLoggedIn) || !errors.Is(err, agent.ErrStartFailed) || !strings.Contains(err.Error(), "Authentication required") {
		t.Fatalf("start: %v", err)
	}
	// Another error is not taken for it.
	b, _, _ := fakeACP(t, "options")
	s, err := b.Start(t.Context(), agent.StartOptions{Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.SetMode(t.Context(), "nope"); err == nil || errors.Is(err, agent.ErrNotLoggedIn) {
		t.Errorf("an invalid mode: %v", err)
	}
}

// What the Cursor CLI 2026.11.22 sent in a turn that ran a command it
// asked to approve: the request has no input, its title the command in
// backticks; the options are ACP's own. (The capture goes on with
// session/load in a new process, which replays the conversation first;
// TestContractCursor resumes through it.)
func TestCursorTurnCapture(t *testing.T) {
	f, err := os.Open("testdata/cursor-2026.11.22-turns.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	s := &session{events: make(chan agent.Event, 256), id: "baf3e59e-d689-4299-b074-952e3882dfda", log: agent.Discard, pending: map[string]permission{}, tools: map[string]bool{}}
	prompts := 0
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		var line struct {
			Dir   string
			Frame envelope
		}
		if err := json.Unmarshal(sc.Bytes(), &line); err != nil {
			t.Fatal(err)
		}
		m := line.Frame
		if line.Dir == "out" {
			if m.Method == "session/prompt" {
				prompts++
				if prompts == 2 { // the command
					id, _ := strconv.Atoi(string(m.ID))
					s.active = id
				}
			}
			continue
		}
		if prompts != 2 {
			continue
		}
		if m.Method != "" {
			s.incoming(m)
		} else {
			s.response(m)
		}
		if s.active == 0 {
			break // the turn ended
		}
	}
	close(s.events)
	var asked *agent.ApprovalRequested
	var output, reply string
	var ended bool
	// steps are the replies as they begin and end, and the tools as they
	// start; texts what each reply says.
	var steps, ids []string
	texts := map[string]string{}
	say := func(id string) {
		if len(ids) == 0 || ids[len(ids)-1] != id {
			ids = append(ids, id)
			steps = append(steps, "reply")
		}
	}
	for ev := range s.events {
		switch e := ev.(type) {
		case agent.ApprovalRequested:
			asked = &e
		case agent.ToolStarted:
			steps = append(steps, "tool")
		case agent.ThinkingDelta:
			say(e.ReplyID)
		case agent.ToolFinished:
			output = e.Output
		case agent.ReplyDelta:
			reply += e.Text
			say(e.ReplyID)
			texts[e.ReplyID] += e.Text
		case agent.ReplyDone:
			steps = append(steps, "done")
		case agent.TurnEnded:
			ended = !e.Interrupted
		}
	}
	if asked == nil || asked.Command != "echo AIBO-ALLOW" || asked.Action != agent.ActionCommand || len(asked.Options) != 3 {
		t.Fatalf("approval %+v", asked)
	}
	var kinds []agent.OptionKind
	for _, o := range asked.Options {
		kinds = append(kinds, o.Kind)
	}
	if !slices.Equal(kinds, []agent.OptionKind{agent.AllowOnce, agent.AllowAlways, agent.Deny}) || asked.Options[0].ID != "allow-once" {
		t.Errorf("options %+v", asked.Options)
	}
	if !strings.Contains(output, "AIBO-ALLOW") || !strings.Contains(reply, "DONE") || !ended {
		t.Errorf("output %q, reply %q, ended %v", output, reply, ended)
	}
	// No messageId: the reply before the command and the one after it
	// are two, in the order they came, the command between them.
	if !slices.Equal(steps, []string{"reply", "done", "tool", "reply", "done"}) || len(ids) != 2 || ids[0] == ids[1] {
		t.Fatalf("steps %q, replies %q", steps, ids)
	}
	if texts[ids[0]] != "我会在当前目录执行你指定的命令。" || strings.TrimSpace(texts[ids[1]]) != "DONE" {
		t.Errorf("replies %q then %q", texts[ids[0]], texts[ids[1]])
	}
}

// Starting a session is bounded by the Agent's start timeout, which its
// requests keep to, rather than each its own 45 seconds.
func TestStartTimeout(t *testing.T) {
	a, _, _ := fakeACP(t, "options-nodelete-slow")
	a.SetStartTimeout(300 * time.Millisecond)
	if _, err := a.Start(t.Context(), agent.StartOptions{Workspace: t.TempDir()}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("a start slower than its timeout: %v", err)
	}
	a.SetStartTimeout(10 * time.Second)
	s, err := a.Start(t.Context(), agent.StartOptions{Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
}
