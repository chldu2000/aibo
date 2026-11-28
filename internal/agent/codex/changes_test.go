package codex

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

// One patch that modifies a file, adds one and deletes one (codex-cli
// 0.172.0): the call tells each file with its own patch, as it starts and
// as it ends.
func TestEditChanges(t *testing.T) {
	f, err := os.Open("testdata/edit-0.172.0.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	p := newThread()
	var started *agent.ToolStarted
	var finished *agent.ToolFinished
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		if strings.HasPrefix(sc.Text(), ">> ") {
			continue // what the probe sent
		}
		var n struct {
			Method string
			Params json.RawMessage
		}
		if json.Unmarshal(sc.Bytes(), &n) != nil || n.Method == "" {
			continue
		}
		for _, e := range p.handle(n.Method, n.Params) {
			switch e := e.(type) {
			case agent.ToolStarted:
				if e.Name == "apply_patch" {
					started = &e
				}
			case agent.ToolFinished:
				if e.Changes != nil {
					finished = &e
				}
			}
		}
	}
	if started == nil || finished == nil {
		t.Fatalf("started %v, finished %v", started, finished)
	}
	want := []agent.FileChange{
		{Path: `C:\sample\a.txt`, Kind: agent.FileModified, Patch: "--- a/C:\\sample\\a.txt\n+++ b/C:\\sample\\a.txt\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n"},
		{Path: `C:\sample\b.txt`, Kind: agent.FileAdded, Patch: "--- /dev/null\n+++ b/C:\\sample\\b.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n"},
		{Path: `C:\sample\c.txt`, Kind: agent.FileDeleted, Patch: "--- a/C:\\sample\\c.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-remove me\n"},
	}
	for _, got := range [][]agent.FileChange{started.Changes, finished.Changes} {
		if len(got) != len(want) {
			t.Fatalf("changes %+v", got)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("change %d is %+v, want %+v", i, got[i], want[i])
			}
		}
	}
}

// An update with a move_path moves the file.
func TestMovedFile(t *testing.T) {
	to := `C:\sample\new.txt`
	var it item
	if err := json.Unmarshal([]byte(`{"type":"fileChange","changes":[{"path":"C:\\sample\\old.txt","kind":{"type":"update","move_path":"C:\\sample\\new.txt"},"diff":""}]}`), &it); err != nil {
		t.Fatal(err)
	}
	got := fileChanges(it)
	if len(got) != 1 || got[0].Kind != agent.FileMoved || got[0].MovedTo != to || got[0].Patch != "" {
		t.Errorf("moved: %+v", got)
	}
}
