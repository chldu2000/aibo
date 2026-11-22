package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

// lines are testdata/settings.jsonl: recorded from codex-cli 0.169.0
// (06-probes/codex_switch.jsonl), the results trimmed to what is read.
func lines(t *testing.T) []json.RawMessage {
	t.Helper()
	f, err := os.Open("testdata/settings.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var out []json.RawMessage
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		out = append(out, json.RawMessage(append([]byte(nil), sc.Bytes()...)))
	}
	return out
}

func TestModelsOfModelList(t *testing.T) {
	var msg struct{ Result json.RawMessage }
	json.Unmarshal(lines(t)[0], &msg)
	ms, err := listModels(msg.Result)
	if err != nil || len(ms) == 0 {
		t.Fatalf("models = %+v, %v", ms, err)
	}
	// The default first, by its own ID: an empty one could not be asked
	// for again in turn/start.
	m := ms[0]
	if m.ID != "gpt-6.2-sol" || m.DefaultEffort != "low" || !slices.Equal(m.Efforts, []string{"low", "medium", "high", "xhigh", "max", "ultra"}) {
		t.Errorf("first = %+v", m)
	}
}

// What a thread uses: as it starts or resumes, and as settings change.
func TestSettingsReported(t *testing.T) {
	ls := lines(t)
	var started, resumed struct{ Result json.RawMessage }
	json.Unmarshal(ls[1], &started)
	json.Unmarshal(ls[3], &resumed)
	if got := threadSettings(started.Result); got != (agent.SettingsReported{Model: "gpt-6.2-sol", Effort: "high"}) {
		t.Errorf("thread/start: %+v", got)
	}
	if got := threadSettings(resumed.Result); got != (agent.SettingsReported{Model: "gpt-5.6-luna", Effort: "low"}) {
		t.Errorf("thread/resume: %+v", got)
	}
	var n struct {
		Method string
		Params json.RawMessage
	}
	json.Unmarshal(ls[2], &n)
	want := []agent.Event{agent.SettingsReported{Model: "gpt-5.6-luna", Effort: "low"}}
	if got := newThread().handle(n.Method, n.Params); !reflect.DeepEqual(got, want) {
		t.Errorf("%s: %#v", n.Method, got)
	}
}

// A model and an effort go with the next turn/start, which Codex keeps
// for the turns after.
func TestTurnCarriesModelAndEffort(t *testing.T) {
	s := &session{id: "T", effort: "max"} // as Start leaves it, given an effort
	p := s.turnParams("a")
	if p["effort"] != "max" || p["model"] != nil {
		t.Errorf("first turn: %v", p)
	}
	if p := s.turnParams("b"); p["effort"] != nil {
		t.Errorf("then: %v", p)
	}
	s.SetModel(context.Background(), "gpt-5.6-luna", "low")
	if p := s.turnParams("c"); p["model"] != "gpt-5.6-luna" || p["effort"] != "low" {
		t.Errorf("after SetModel: %v", p)
	}
	if p := s.turnParams("d"); p["model"] != nil || p["effort"] != nil {
		t.Errorf("then: %v", p)
	}
}

// Files go after the text as paths, for Codex to read itself.
func TestTurnWithFiles(t *testing.T) {
	got := withFiles("看看这些", []agent.FileMention{{Path: "/w/src/main.go", Rel: "src/main.go"}, {Path: "/other/lib/", Dir: true}})
	if want := "看看这些\n\n提到的文件（需要时请自己读取）：\n- src/main.go\n- /other/lib/（目录）"; got != want {
		t.Errorf("text = %q, want %q", got, want)
	}
}
