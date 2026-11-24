package claude

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

// What get_settings answers is what the session uses; set_model's echo of
// itself as a user message is no message. Recorded from Claude Code
// 2.1.318 (06-probes/claude_switch.jsonl, request IDs renamed to the
// adapter's).
func TestSettingsReported(t *testing.T) {
	f, err := os.Open("testdata/settings.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	p := newParser()
	var got []agent.Event
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		got = append(got, p.line(sc.Bytes())...)
	}
	want := []agent.Event{
		agent.SettingsReported{Model: "claude-haiku-5-5", Effort: "low"},
		agent.SettingsReported{Model: "claude-sonnet-5-5", Effort: "high"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("events = %#v", got)
	}
}

// initialize's models, with what each runs as and the efforts it takes.
func TestModelsOfInitialize(t *testing.T) {
	b, err := os.ReadFile("testdata/models.json")
	if err != nil {
		t.Fatal(err)
	}
	ms, ok := models(b)
	if !ok || len(ms) != 5 {
		t.Fatalf("models = %+v, %v", ms, ok)
	}
	efforts := []string{"low", "medium", "high", "xhigh", "max"}
	def, opus := ms[0], ms[1]
	if def.ID != "" || def.Name != "Default (recommended)" || def.Resolved != "claude-opus-5-5" || !slices.Equal(def.Efforts, efforts) {
		t.Errorf("default = %+v", def)
	}
	if opus.ID != "opus" || !opus.Runs("claude-opus-5-5") || !opus.Runs("opus") || opus.Runs("claude-sonnet-5-5") {
		t.Errorf("opus = %+v", opus)
	}
	// A model without supportsEffort (made up: older models leave it out)
	// takes none.
	old, _ := models([]byte(`{"type":"control_response","response":{"request_id":"models","response":{"models":[{"value":"claude-haiku-4-5","displayName":"Haiku 4.5"}]}}}`))
	if len(old) != 1 || old[0].Efforts != nil {
		t.Errorf("without supportsEffort: %+v", old)
	}
}

// The effort goes on the command line: Claude Code does not keep it when
// it resumes.
func TestArgsEffort(t *testing.T) {
	a := New("claude")
	args := a.args(agent.StartOptions{Model: "sonnet", Effort: "high", ResumeID: "r"})
	if i := slices.Index(args, "--effort"); i < 0 || args[i+1] != "high" {
		t.Errorf("args = %q", args)
	}
	if slices.Contains(a.args(agent.StartOptions{}), "--effort") {
		t.Error("--effort without an effort")
	}
}

// Plan mode, as Claude Code 2.1.318 ran it (research/11, home rewritten
// as ~): each turn says its mode, and ExitPlanMode asks to approve the
// plan.
func TestPlanMode(t *testing.T) {
	f, err := os.Open("testdata/modes.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	p := newParser()
	var got []agent.Event
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		got = append(got, p.line(sc.Bytes())...)
	}
	var modes []string
	var plan *agent.ApprovalRequested
	for _, e := range got {
		switch e := e.(type) {
		case agent.ModeReported:
			modes = append(modes, e.ID)
		case agent.ApprovalRequested:
			plan = &e
		}
	}
	if !slices.Equal(modes, []string{"plan"}) {
		t.Errorf("modes = %v", modes)
	}
	if plan == nil || plan.Action != agent.ActionPlan || !strings.HasPrefix(plan.Plan, "# Plan: create a.txt") {
		t.Fatalf("approval = %+v", plan)
	}
	if o := plan.Options; len(o) == 0 || o[0].Kind != agent.AllowOnce {
		t.Errorf("options = %+v", o)
	}
}

// Claude Code's modes: "manual" is not one, only another name of default.
func TestModes(t *testing.T) {
	ms, _ := New("claude").PermissionModes(context.Background())
	var ids []string
	for _, m := range ms {
		ids = append(ids, m.ID)
	}
	if !slices.Equal(ids, []string{"default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"}) {
		t.Errorf("modes = %v", ids)
	}
	if !ms[0].Default || ms[5].Risk != agent.Danger || !ms[2].ReadOnly {
		t.Errorf("modes = %+v", ms)
	}
}

// A message the adapter does not know goes to the diagnostic log as its
// type and its fields' names; one it knows and ignores does not. (The
// unknown ones are made up.)
func TestUnknownMessagesLogged(t *testing.T) {
	var buf bytes.Buffer
	p := newParser()
	p.log = slog.New(slog.NewTextHandler(&buf, nil))
	for _, l := range []string{
		`{"type":"brand_new","text":"the secret word is pelican"}`,
		`{"type":"system","subtype":"brand_new_subtype","detail":"walrus"}`,
		`{"type":"control_request","request_id":"r","request":{"subtype":"elicit","prompt":"walrus"}}`,
		`{"type":"system","subtype":"status","status":"compacting"}`,
		`{"type":"rate_limit_event","rate_limit_info":{}}`,
		`{"type":"system","subtype":"commands_changed","commands":[]}`,
	} {
		if evs := p.line([]byte(l)); len(evs) != 0 {
			t.Errorf("%s → %v", l, evs)
		}
	}
	log := buf.String()
	for _, want := range []string{"type=brand_new subtype=\"\" fields=text,type", "subtype=brand_new_subtype", "subtype=elicit"} {
		if !strings.Contains(log, want) {
			t.Errorf("the log lacks %q:\n%s", want, log)
		}
	}
	if strings.Count(log, "unknown message") != 3 || strings.Contains(log, "pelican") || strings.Contains(log, "walrus") {
		t.Errorf("log:\n%s", log)
	}
}

// Everything Claude Code was recorded saying is known: none of it goes to
// the log as unknown.
func TestRecordedMessagesAreKnown(t *testing.T) {
	files, _ := filepath.Glob("testdata/*.jsonl")
	var buf bytes.Buffer
	p := newParser()
	p.log = slog.New(slog.NewTextHandler(&buf, nil))
	for _, name := range files {
		f, err := os.Open(name)
		if err != nil {
			t.Fatal(err)
		}
		sc := bufio.NewScanner(f)
		sc.Buffer(nil, 1<<20)
		for sc.Scan() {
			p.line(sc.Bytes())
		}
		f.Close()
	}
	if buf.Len() > 0 {
		t.Errorf("logged as unknown:\n%s", buf.String())
	}
}

// Files go after the text as Claude Code reads them itself: @path,
// quoted with a space, absolute outside the workspace.
func TestTurnWithFiles(t *testing.T) {
	got := withFiles(agent.Turn{Text: "看看这些", Files: []agent.FileMention{
		{Path: "/w/src/main.go", Rel: "src/main.go"},
		{Path: "/w/my notes.txt", Rel: "my notes.txt"},
		{Path: "/other/lib/", Dir: true},
	}})
	if want := "看看这些\n\n提到的文件：\n@src/main.go\n@\"my notes.txt\"\n@/other/lib/"; got != want {
		t.Errorf("text = %q, want %q", got, want)
	}
	if withFiles(agent.Turn{Text: "hi"}) != "hi" {
		t.Error("no files, other text")
	}
}

// Images go before the text as base64 image blocks; an image alone goes
// without a text block, which Claude refuses empty.
func TestTurnWithImages(t *testing.T) {
	p := filepath.Join(t.TempDir(), "a.png")
	os.WriteFile(p, []byte("png"), 0o644)
	got, err := turnContent(agent.Turn{Text: "看图", Images: []agent.Image{{Path: p, MIME: "image/png"}}})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(got)
	if want := `[{"source":{"data":"cG5n","media_type":"image/png","type":"base64"},"type":"image"},{"text":"看图","type":"text"}]`; string(b) != want {
		t.Errorf("content = %s", b)
	}
	alone, _ := turnContent(agent.Turn{Images: []agent.Image{{Path: p, MIME: "image/png"}}})
	if b, _ := json.Marshal(alone); strings.Contains(string(b), `"text"`) {
		t.Errorf("an image alone → %s", b)
	}
	if c, _ := turnContent(agent.Turn{Text: "hi"}); c != "hi" {
		t.Errorf("text alone → %#v", c)
	}
	if _, err := turnContent(agent.Turn{Images: []agent.Image{{Path: p + ".gone", MIME: "image/png"}}}); err == nil {
		t.Error("a missing image was sent")
	}
}
