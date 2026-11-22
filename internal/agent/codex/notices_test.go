package codex

import (
	"bufio"
	"bytes"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A notification the adapter does not know goes to the diagnostic log as
// its method and its fields' names, once; Codex's own warnings with what
// they say; what it knows and ignores, not at all. (The unknown ones are
// made up.)
func TestNoticesLogged(t *testing.T) {
	var buf bytes.Buffer
	s := &server{log: slog.New(slog.NewTextHandler(&buf, nil)), sessions: map[string]*session{}, stdin: discard{}}
	for _, n := range []struct{ method, params string }{
		{"brand/new", `{"threadId":"T","text":"the secret word is pelican"}`},
		{"brand/new", `{"threadId":"T","text":"again"}`},
		{"warning", `{"message":"config.toml: unknown key"}`},
		{"thread/tokenUsage/updated", `{"threadId":"T","tokenUsage":{}}`},
		{"item/commandExecution/outputDelta", `{"threadId":"T","delta":"walrus"}`},
	} {
		s.notify(n.method, json.RawMessage(n.params))
	}
	s.request(json.RawMessage(`7`), "brand/ask", json.RawMessage(`{"threadId":"T","prompt":"walrus"}`))
	log := buf.String()
	for _, want := range []string{`msg="unknown notification" method=brand/new fields=text,threadId`, `msg="codex warning" method=warning message="config.toml: unknown key"`, `msg="unknown request" method=brand/ask fields=prompt,threadId`} {
		if !strings.Contains(log, want) {
			t.Errorf("the log lacks %q:\n%s", want, log)
		}
	}
	if strings.Count(log, "brand/new") != 1 || strings.Contains(log, "pelican") || strings.Contains(log, "walrus") || strings.Contains(log, "tokenUsage") {
		t.Errorf("log:\n%s", log)
	}
}

// Everything Codex was recorded saying is known.
func TestRecordedNoticesAreKnown(t *testing.T) {
	files, _ := filepath.Glob("testdata/*.jsonl")
	var buf bytes.Buffer
	s := &server{log: slog.New(slog.NewTextHandler(&buf, nil)), sessions: map[string]*session{}}
	for _, name := range files {
		f, _ := os.Open(name)
		sc := bufio.NewScanner(f)
		sc.Buffer(nil, 1<<20)
		for sc.Scan() {
			var m struct {
				Method string
				Params json.RawMessage
			}
			if json.Unmarshal(sc.Bytes(), &m) == nil && m.Method != "" {
				s.notify(m.Method, m.Params)
			}
		}
		f.Close()
	}
	if strings.Contains(buf.String(), "unknown") {
		t.Errorf("logged as unknown:\n%s", buf.String())
	}
}

// discard is a stdin that takes the declines of unknown requests.
type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }
func (discard) Close() error                { return nil }
