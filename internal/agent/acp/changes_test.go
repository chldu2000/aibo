package acp

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

// changesOf replays a capture's session updates and returns the changes
// its calls tell as they end, by file name.
func changesOf(t *testing.T, name string) map[string]agent.FileChange {
	t.Helper()
	f, err := os.Open("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	s := &session{events: make(chan agent.Event, 256), log: agent.Discard, pending: map[string]permission{}, tools: map[string]bool{}, declined: map[string]bool{}}
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<22)
	for sc.Scan() {
		var m struct {
			Method string
			Params struct{ Update json.RawMessage }
		}
		if strings.HasPrefix(sc.Text(), ">> ") || json.Unmarshal(sc.Bytes(), &m) != nil || m.Method != "session/update" {
			continue
		}
		s.update(m.Params.Update, 1)
	}
	close(s.events)
	got := map[string]agent.FileChange{}
	for ev := range s.events {
		if e, ok := ev.(agent.ToolFinished); ok {
			for _, ch := range e.Changes {
				got[ch.Path[strings.LastIndex(ch.Path, `\`)+1:]] = ch
			}
		}
	}
	return got
}

const sample = `C:\sample\`

// The Cursor CLI (2026.11.22) tells a file edited by its texts before and
// after, which make a patch; one created, by headers cut short before its
// text, which make it added.
func TestCursorEditChanges(t *testing.T) {
	got := changesOf(t, "cursor-2026.11.22-edit.jsonl")
	want := map[string]agent.FileChange{
		"a.txt": {Path: sample + "a.txt", Kind: agent.FileModified, Patch: agent.PatchHunks(sample+"a.txt", "@@ -1,5 +1,5 @@\n one\n-two\n+TWO\n three\n four\n five")},
		"b.txt": {Path: sample + "b.txt", Kind: agent.FileAdded, Patch: agent.PatchAdded(sample+"b.txt", "hello\nworld")},
	}
	if len(got) != len(want) {
		t.Fatalf("changes %+v", got)
	}
	for k, w := range want {
		if got[k] != w {
			t.Errorf("%s: %+v, want %+v", k, got[k], w)
		}
	}
}

// OpenCode (2.4.2) tells a file edited by its texts; of one it creates, no
// diff, so none shows.
func TestOpenCodeEditChanges(t *testing.T) {
	got := changesOf(t, "opencode-2.4.2-edit.jsonl")
	a := sample + "a.txt"
	if len(got) != 1 || got["a.txt"] != (agent.FileChange{Path: a, Kind: agent.FileModified, Patch: agent.PatchHunks(a, "@@ -1,5 +1,5 @@\n one\n-two\n+TWO\n three\n four\n five")}) {
		t.Errorf("changes %+v", got)
	}
}

// A diff without oldText is a file created, as ACP has it.
func TestDiffWithoutOldText(t *testing.T) {
	var tc toolCall
	if err := json.Unmarshal([]byte(`{"toolCallId":"t","content":[{"type":"diff","path":"/w/n.txt","newText":"x\n"}]}`), &tc); err != nil {
		t.Fatal(err)
	}
	if got := fileChanges(tc); len(got) != 1 || got[0].Kind != agent.FileAdded || got[0].Patch != agent.PatchAdded("/w/n.txt", "x\n") {
		t.Errorf("changes %+v", got)
	}
}
