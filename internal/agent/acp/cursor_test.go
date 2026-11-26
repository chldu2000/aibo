package acp

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

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
