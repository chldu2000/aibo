package shell

import (
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

// A glyph's letter is the first letter or digit of the Agent's name.
func TestGlyphLetter(t *testing.T) {
	for _, c := range []struct {
		name string
		kind agent.Kind
		want rune
		ok   bool
	}{
		{"gemini", "gemini", 'G', true},
		{"  Goose ", "goose", 'G', true},
		{"acp-kimi", "kimi", 'K', true},
		{"ACP Qwen", "qwen", 'Q', true},
		{"acp-", "acp", 'A', true},
		{"ｍｉｓｔｒａｌ", "mistral", 'M', true},
		{"通义灵码", "lingma", '通', true},
		{"「小助手」", "helper", '小', true},
		{"[beta] Droid", "droid", 'B', true},
		{"42 agent", "42", '4', true},
		{"🤖🚀", "robots", 0, false},
		{"", "acp-cline", 'C', true},
		{"", "", 0, false},
	} {
		got, ok := glyphLetter(c.name, c.kind)
		if got != c.want || ok != c.ok {
			t.Errorf("glyphLetter(%q, %q) = %q, %v; want %q, %v", c.name, c.kind, got, ok, c.want, c.ok)
		}
	}
}

// A glyph's color follows the Agent's ID alone, and is one of the
// palette's.
func TestGlyphColor(t *testing.T) {
	seen := map[[4]uint8]bool{}
	for _, id := range []agent.Kind{"gemini", "goose", "kimi", "qwen", "cline", "droid", "opencode", "cursor", "amp", "augment", "junie", "kiro"} {
		c := glyphColor(id)
		if glyphColor(id) != c {
			t.Errorf("%s: the color changed", id)
		}
		in := false
		for _, p := range glyphColors {
			in = in || p == c
		}
		if !in {
			t.Errorf("%s: %v is not in the palette", id, c)
		}
		seen[[4]uint8{c.R, c.G, c.B, c.A}] = true
	}
	if len(seen) < 4 {
		t.Errorf("twelve IDs took %d colors", len(seen))
	}
}
