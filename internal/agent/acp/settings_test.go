package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
)

func TestMain(m *testing.M) {
	if v := os.Getenv("AIBO_ACP_FAKE"); v != "" {
		if p := os.Getenv("AIBO_ACP_ARGS"); p != "" {
			os.WriteFile(p, []byte(strings.Join(os.Args[1:], "\n")), 0o600)
		}
		fakeAgent(v, os.Getenv("AIBO_ACP_LOG"))
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// settingsOf drains the reports queued on a bare session.
func settingsOf(s *session) (got []string) {
	for {
		select {
		case ev := <-s.events:
			switch e := ev.(type) {
			case agent.SettingsReported:
				got = append(got, "model="+e.Model, "effort="+e.Effort)
			case agent.ModeReported:
				got = append(got, "mode="+e.ID)
			}
		default:
			return got
		}
	}
}

// What OpenCode 2.4.2 answered while its model, effort and mode changed,
// and when the session was resumed in another process.
func TestOpenCodeSettingsCapture(t *testing.T) {
	f, err := os.Open("testdata/opencode-2.4.2-settings.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	want := [][]string{
		{"model=opencode/big-pickle", "effort=", "mode=build"},                      // session/new
		{"model=opencode/deepseek-v4.1-flash-free", "effort=default", "mode=build"}, // an effort appears, at its default
		{"model=opencode/deepseek-v4.1-flash-free", "effort=high", "mode=build"},
		{"model=opencode/deepseek-v4.1-flash-free", "effort=high", "mode=plan"},
		{"model=opencode/mimo-v2.6-flash-free", "effort=", "mode=plan"},            // and goes
		{"model=opencode/deepseek-v4.1-flash-free", "effort=default", "mode=plan"}, // back at the default
		{"model=opencode/deepseek-v4.1-flash-free", "effort=max", "mode=plan"},
		{"model=opencode/deepseek-v4.1-flash-free", "effort=max", "mode=plan"}, // resumed
	}
	s := &session{events: make(chan agent.Event, 8), log: agent.Discard}
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
			s.configure(info.ConfigOptions, info.Modes, info.SessionID != "")
		} else {
			s.replace(info.ConfigOptions)
		}
		s.report()
		got = append(got, settingsOf(s))
	}
	if !slices.EqualFunc(got, want, slices.Equal) {
		t.Fatalf("reports\n got %q\nwant %q", got, want)
	}
	effort, _ := option(s.options, categoryEffort)
	if c := effort.choices(); len(c) != 4 || !effort.offers(defaultEffort) || effort.ID != "effort" {
		t.Errorf("effort choices = %+v", c)
	}
	model, _ := option(s.options, categoryModel)
	if len(model.choices()) < 2 {
		t.Errorf("model choices = %+v", model.choices())
	}
}

func TestGroupedChoices(t *testing.T) {
	o := configOption{Options: json.RawMessage(`[{"group":"a","name":"A","options":[{"value":"x","name":"X"}]},{"group":"b","name":"B","options":[{"value":"y","name":"Y"}]}]`)}
	if c := o.choices(); len(c) != 2 || c[0].Value != "x" || c[1].Name != "Y" {
		t.Fatalf("choices = %+v", c)
	}
}

func TestReportedUpdates(t *testing.T) {
	s := &session{events: make(chan agent.Event, 8), log: agent.Discard}
	s.update(json.RawMessage(`{"sessionUpdate":"config_option_update","configOptions":[{"id":"m","category":"model","currentValue":"a"},{"id":"mode","category":"mode","currentValue":"plan"}]}`), 0)
	if got := settingsOf(s); !slices.Equal(got, []string{"model=a", "effort=", "mode=plan"}) {
		t.Errorf("config_option_update reported %q", got)
	}
	// Without modes from session/new there is nothing to follow.
	s.update(json.RawMessage(`{"sessionUpdate":"current_mode_update","currentModeId":"x"}`), 0)
	if got := settingsOf(s); got != nil {
		t.Errorf("unknown modes reported %q", got)
	}
	s = &session{events: make(chan agent.Event, 8), log: agent.Discard}
	s.configure(nil, &legacyModes{CurrentModeID: "ask"}, true)
	s.update(json.RawMessage(`{"sessionUpdate":"current_mode_update","currentModeId":"code"}`), 0)
	if got := settingsOf(s); !slices.Equal(got, []string{"mode=code"}) {
		t.Errorf("current_mode_update reported %q", got)
	}
}

// start runs this test binary as a fake ACP Agent of the given kind; the
// returned function reads the requests it received.
func start(t *testing.T, kind string, o agent.StartOptions) (agent.Session, func() []string) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(t.TempDir(), "requests")
	a := New("fake-acp", "Fake ACP", exe, nil, "")
	a.Configure(exe, []string{"AIBO_ACP_FAKE=" + kind, "AIBO_ACP_LOG=" + log})
	o.Workspace = t.TempDir()
	s, err := a.Start(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, func() []string {
		b, _ := os.ReadFile(log)
		return strings.Fields(string(b))
	}
}

// reports collects the settings a session reported until it is quiet.
func reports(s agent.Session) (got []string) {
	for {
		select {
		case ev := <-s.Events():
			switch e := ev.(type) {
			case agent.SettingsReported:
				got = append(got, "model="+e.Model, "effort="+e.Effort)
			case agent.ModeReported:
				got = append(got, "mode="+e.ID)
			}
		case <-time.After(200 * time.Millisecond):
			return got
		}
	}
}

func TestStartWithSettings(t *testing.T) {
	s, requests := start(t, "options", agent.StartOptions{Model: "m0", Effort: "high", Mode: "plan"})
	// One report, after the settings: an earlier "build" would read as
	// the Agent leaving plan mode.
	if got := reports(s); !slices.Equal(got, []string{"model=m0", "effort=high", "mode=plan"}) {
		t.Errorf("reported %q", got)
	}
	if got := requests(); !slices.Equal(got, []string{"session/new", "model=m0", "effort=high", "mode=plan"}) {
		t.Errorf("requests %q", got)
	}
}

func TestSwitchSettings(t *testing.T) {
	ctx := context.Background()
	s, requests := start(t, "options", agent.StartOptions{})
	reports(s)
	if err := s.SetModel(ctx, "m0", "high"); err != nil {
		t.Fatal(err)
	}
	if got := reports(s); !slices.Equal(got, []string{"model=m0", "effort=high", "mode=build"}) {
		t.Errorf("after effort, reported %q", got)
	}
	// m1 takes no effort.
	if err := s.SetModel(ctx, "m1", "high"); err == nil {
		t.Error("an effort was set for a model without one")
	}
	if got := reports(s); !slices.Equal(got, []string{"model=m1", "effort=", "mode=build"}) {
		t.Errorf("after m1, reported %q", got)
	}
	// Empty is the session's first model, at its default effort.
	if err := s.SetModel(ctx, "", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMode(ctx, "plan"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMode(ctx, ""); err != nil {
		t.Fatal(err)
	}
	if got := reports(s); !slices.Equal(got, []string{"model=m2", "effort=default", "mode=build", "model=m2", "effort=default", "mode=plan", "model=m2", "effort=default", "mode=build"}) {
		t.Errorf("after defaults, reported %q", got)
	}
	if err := s.SetMode(ctx, "nope"); err == nil {
		t.Error("an unknown mode was set")
	}
	want := []string{"session/new", "model=m0", "effort=high", "model=m1", "model=m2", "mode=plan", "mode=build", "mode=nope"}
	if got := requests(); !slices.Equal(got, want) {
		t.Errorf("requests\n got %q\nwant %q", got, want)
	}
}

func TestLegacyModes(t *testing.T) {
	ctx := context.Background()
	s, requests := start(t, "legacy", agent.StartOptions{Mode: "architect"})
	if got := reports(s); !slices.Equal(got, []string{"mode=architect"}) {
		t.Errorf("reported %q", got)
	}
	if err := s.SetModel(ctx, "", ""); err != nil {
		t.Errorf("the Agent's own model: %v", err)
	}
	if err := s.SetModel(ctx, "x", ""); err == nil {
		t.Error("a model was set on an Agent without a model selection")
	}
	if err := s.SetMode(ctx, ""); err != nil {
		t.Fatal(err)
	}
	if got := reports(s); !slices.Equal(got, []string{"mode=architect", "mode=architect", "mode=code"}) {
		t.Errorf("after switching, reported %q", got)
	}
	if got := requests(); !slices.Equal(got, []string{"session/new", "set_mode=architect", "set_mode=code"}) {
		t.Errorf("requests %q", got)
	}
}

// fakeAgent answers ACP on stdio. "options" offers models m2 (its
// default, which takes efforts), m0 (efforts too) and m1 (none), and
// modes build and plan, as configOptions, and can delete sessions;
// "options-nodelete" cannot. "legacy" offers only modes code and
// architect, as modes, and cannot delete sessions. Each request that changes a setting is
// logged as key=value.
func fakeAgent(kind, logPath string) {
	// A probe and a session can share the log.
	logf, _ := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	legacy, deletes := strings.Contains(kind, "legacy"), !strings.Contains(kind, "nodelete") && !strings.Contains(kind, "legacy")
	defer logf.Close()
	model, effort, mode := "m2", "default", "build"
	if legacy {
		mode = "code"
	}
	choices := func(vs ...string) []map[string]string {
		var out []map[string]string
		for _, v := range vs {
			out = append(out, map[string]string{"value": v, "name": strings.ToUpper(v)})
		}
		return out
	}
	opts := func() []map[string]any {
		o := []map[string]any{{"id": "model", "category": "model", "type": "select", "currentValue": model, "options": choices("m2", "m0", "m1")}}
		if model != "m1" {
			o = append(o, map[string]any{"id": "effort", "category": "thought_level", "type": "select", "currentValue": effort, "options": choices("low", "high", "default")})
		}
		return append(o, map[string]any{"id": "mode", "category": "mode", "type": "select", "currentValue": mode, "options": choices("build", "plan")})
	}
	enc := json.NewEncoder(os.Stdout)
	sc := bufio.NewScanner(os.Stdin)
	for sc.Scan() {
		var req struct {
			ID     json.RawMessage
			Method string
			Params struct{ ConfigID, Value, ModeID string }
		}
		json.Unmarshal(sc.Bytes(), &req)
		reply := func(result any, fail string) {
			m := map[string]any{"jsonrpc": "2.0", "id": req.ID}
			if fail != "" {
				m["error"] = map[string]any{"code": -32602, "message": fail}
			} else {
				m["result"] = result
			}
			enc.Encode(m)
		}
		switch req.Method {
		case "initialize":
			if p := os.Getenv("AIBO_ACP_INIT"); p != "" {
				os.WriteFile(p, sc.Bytes(), 0o600)
			}
			caps := map[string]any{}
			if deletes {
				caps["sessionCapabilities"] = map[string]any{"delete": map[string]any{}}
			}
			reply(map[string]any{"protocolVersion": 1, "agentCapabilities": caps}, "")
		case "session/new":
			fmt.Fprintln(logf, "session/new")
			if strings.Contains(kind, "signedout") {
				enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": -32000, "message": "Authentication required"}})
				continue
			}
			if legacy {
				reply(map[string]any{"sessionId": "s1", "modes": map[string]any{"currentModeId": mode, "availableModes": []map[string]string{{"id": "code", "name": "Code"}, {"id": "architect", "name": "Architect"}}}}, "")
			} else {
				reply(map[string]any{"sessionId": "s1", "configOptions": opts()}, "")
			}
		case "session/delete":
			fmt.Fprintln(logf, "session/delete")
			reply(map[string]any{}, "")
		case "session/set_mode":
			fmt.Fprintf(logf, "set_mode=%s\n", req.Params.ModeID)
			mode = req.Params.ModeID
			reply(map[string]any{}, "")
		case "session/set_config_option":
			p := req.Params
			fmt.Fprintf(logf, "%s=%s\n", p.ConfigID, p.Value)
			switch {
			case p.ConfigID == "model" && slices.Contains([]string{"m0", "m1", "m2"}, p.Value):
				model, effort = p.Value, "default"
			case p.ConfigID == "effort" && model != "m1" && slices.Contains([]string{"low", "high", "default"}, p.Value):
				effort = p.Value
			case p.ConfigID == "mode" && (p.Value == "build" || p.Value == "plan"):
				mode = p.Value
			default:
				reply(nil, "Invalid params")
				continue
			}
			reply(map[string]any{"configOptions": opts()}, "")
		default:
			reply(nil, "method not supported")
		}
	}
}
