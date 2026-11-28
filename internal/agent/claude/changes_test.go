package claude

import (
	"bufio"
	"os"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

// A turn that edits a file, creates one and replaces one (Claude Code
// 2.1.332): each call's result carries the patch Claude Code worked out;
// the reads before carry none.
func TestEditChanges(t *testing.T) {
	f, err := os.Open("testdata/edit.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	p := newParser()
	var got []agent.ToolFinished
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		for _, e := range p.line(sc.Bytes()) {
			if f, ok := e.(agent.ToolFinished); ok {
				got = append(got, f)
			}
		}
	}
	if len(got) != 5 {
		t.Fatalf("%d results: %+v", len(got), got)
	}
	for _, read := range got[:2] {
		if read.Changes != nil {
			t.Errorf("a read changed %+v", read.Changes)
		}
	}
	want := []agent.FileChange{
		{Path: `C:\sample\a.txt`, Kind: agent.FileModified, Patch: "--- a/C:\\sample\\a.txt\n+++ b/C:\\sample\\a.txt\n@@ -1,5 +1,5 @@\n one\n-two\n+TWO\n three\n four\n five\n"},
		{Path: `C:\sample\b.txt`, Kind: agent.FileAdded, Patch: "--- /dev/null\n+++ b/C:\\sample\\b.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n\\ No newline at end of file\n"},
		{Path: `C:\sample\d.txt`, Kind: agent.FileModified, Patch: "--- a/C:\\sample\\d.txt\n+++ b/C:\\sample\\d.txt\n@@ -1,1 +1,1 @@\n-old content\n+new content\n\\ No newline at end of file\n"},
	}
	for i, w := range want {
		ch := got[2+i].Changes
		if len(ch) != 1 || ch[0] != w {
			t.Errorf("call %d changed %+v, want %+v", 3+i, ch, w)
		}
	}
	if a, d := agent.PatchStats(want[0].Patch); a != 1 || d != 1 {
		t.Errorf("the edit counts +%d −%d", a, d)
	}
}
