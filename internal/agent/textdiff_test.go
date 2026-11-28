package agent

import (
	"fmt"
	"strings"
	"testing"
)

func numbered(from, to int) []string {
	var out []string
	for i := from; i <= to; i++ {
		out = append(out, fmt.Sprintf("l%d", i))
	}
	return out
}

func text(lines ...string) string { return strings.Join(lines, "\n") + "\n" }

// The texts an Agent tells before and after, as a patch: the lines
// changed, with three around them, as git diff writes them.
func TestPatchTexts(t *testing.T) {
	const head = "--- a/f\n+++ b/f\n"
	ten := numbered(1, 10)
	replaced := append(append(append([]string{}, ten[:4]...), "L5"), ten[5:]...)
	inserted := append(append(append([]string{}, ten[:2]...), "new"), ten[2:]...)
	far := append([]string{}, ten...)
	far[0], far[9] = "L1", "L10"
	for _, c := range []struct {
		name, old, new, want string
	}{
		{"same", text(ten...), text(ten...), ""},
		{"a line replaced", text(ten...), text(replaced...),
			head + "@@ -2,7 +2,7 @@\n l2\n l3\n l4\n-l5\n+L5\n l6\n l7\n l8\n"},
		{"a line inserted", text(ten...), text(inserted...),
			head + "@@ -1,5 +1,6 @@\n l1\n l2\n+new\n l3\n l4\n l5\n"},
		{"two changes far apart", text(ten...), text(far...),
			head + "@@ -1,4 +1,4 @@\n-l1\n+L1\n l2\n l3\n l4\n@@ -7,4 +7,4 @@\n l7\n l8\n l9\n-l10\n+L10\n"},
		{"from nothing", "", text("a", "b"), head + "@@ -0,0 +1,2 @@\n+a\n+b\n"},
		{"to nothing", text("a"), "", head + "@@ -1,1 +0,0 @@\n-a\n"},
	} {
		if got := PatchTexts("f", c.old, c.new); got != c.want {
			t.Errorf("%s:\n%s\nwant\n%s", c.name, got, c.want)
		}
	}
}

// Past what the table holds, the part that differs is deleted and added
// whole: a diff still, which counts every line of it.
func TestPatchTextsBig(t *testing.T) {
	old, new := numbered(1, 3000), numbered(1, 3000)
	for i := 1; i < 2999; i++ {
		new[i] += "x"
	}
	got := PatchTexts("f", text(old...), text(new...))
	added, deleted := PatchStats(got)
	if added != 2998 || deleted != 2998 || !strings.HasPrefix(got, "--- a/f\n+++ b/f\n@@ -1,3000 +1,3000 @@\n l1\n-l2\n") {
		t.Errorf("+%d −%d: %.80q", added, deleted, got)
	}
}
