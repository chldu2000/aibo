package shell

import "testing"

// An "@" typed at the start of a line or after a space opens the @ panel
// and stays in the draft; one typed after a letter or digit is text.
func TestTypedAt(t *testing.T) {
	for _, c := range []struct {
		name          string
		before, after string
		at            int // -1: the panel does not open
	}{
		{"empty draft", "", "@", 0},
		{"line start", "first\n", "first\n@", 6},
		{"after a space", "write ", "write @", 6},
		{"after a tab", "a\t", "a\t@", 2},
		{"after a letter", "a", "a@", -1},
		{"after a digit", "1", "1@", -1},
		{"after a Chinese character", "按这个写", "按这个写@", -1},
		{"mid-draft after a space", "ab cd", "ab @cd", 3},
		{"mid-draft after a letter", "ab cd", "ab c@d", -1},
		{"input method commits text ending in @", "x ", "x 写@", -1},
		{"input method commits a space and @", "x", "x @", 2},
		{"input method commits @ alone", "", "@", 0},
		{"full-width @ is text", "", "＠", -1},
		{"no @ inserted", "a", "ab", -1},
		{"@ not at the end of the insertion", "", "@b", -1},
		{"deletion", "a @", "a ", -1},
		{"unchanged", "a @", "a @", -1},
		{"after a multi-byte space", "x　", "x　@", len("x　")},
	} {
		t.Run(c.name, func(t *testing.T) {
			at, ok := typedAt(c.before, c.after)
			if c.at < 0 {
				if ok {
					t.Fatalf("typedAt(%q, %q) opens the panel at %d", c.before, c.after, at)
				}
				return
			}
			if !ok || at != c.at {
				t.Fatalf("typedAt(%q, %q) = %d, %v; want %d, true", c.before, c.after, at, ok, c.at)
			}
		})
	}
}

// Choosing a reference takes the "@" that opened the panel out of the
// draft, when it is still there.
func TestDropAt(t *testing.T) {
	for _, c := range []struct {
		draft string
		at    int
		want  string
	}{
		{"write @", 6, "write "},
		{"ab @cd", 3, "ab cd"},
		{"write ", 6, "write "},   // the user deleted it
		{"write x", 6, "write x"}, // something else there now
		{"@", 0, ""},
		{"x", -1, "x"},
	} {
		if got := dropAt(c.draft, c.at); got != c.want {
			t.Errorf("dropAt(%q, %d) = %q; want %q", c.draft, c.at, got, c.want)
		}
	}
}
