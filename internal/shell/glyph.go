package shell

import (
	"hash/fnv"
	"strings"
	"unicode"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/egoist/mygo/ui"
	"golang.org/x/text/unicode/norm"
)

// genericGlyph is the icon of an Agent with neither an icon of its own
// nor a letter or digit in its name.
var genericGlyph = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#6e6e78"/><g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="10" r="4"/><path d="M6 19c1.5-2.5 3.5-3.5 6-3.5s4.5 1 6 3.5"/></g></svg>`))

// glyphColors are the backgrounds of letter glyphs: OKLCH lightness 0.56,
// chroma about 0.12, the hues spread apart, where white letters read.
// They leave out the reds and ochres near Claude's icon and errors, the
// oranges and yellows of warnings, and the greys of Codex and
// genericGlyph.
var glyphColors = [...]ui.Color{
	ui.Hex("#af4f71"), // 0°, rose
	ui.Hex("#5a8325"), // 130°, grass
	ui.Hex("#2d8949"), // 150°, green
	ui.Hex("#008c70"), // 175°, teal
	ui.Hex("#008a92"), // 200°, cyan
	ui.Hex("#0082ad"), // 225°, sky
	ui.Hex("#2d78bd"), // 250°, blue
	ui.Hex("#5f6cc0"), // 275°, indigo
	ui.Hex("#8160b5"), // 300°, violet
	ui.Hex("#9a579e"), // 325°, magenta
}

// agentIcon is how an Agent's icon draws: its own icon, or else a letter of
// its name on a color of its own. name is the name it was worked out for.
type agentIcon struct {
	name   string
	svg    *ui.SVG
	letter rune
	color  ui.Color
}

// agentGlyph is an Agent's icon, its name on hover: the Agent's own
// (agents.Spec.Glyph), else the first letter of its name on its color
// (glyphLetter, glyphColor), else genericGlyph.
func (s *Shell) agentGlyph(c *ui.Context, kind agent.Kind, size float32) ui.Element {
	name := s.agentName(kind)
	g, ok := s.glyphs[kind]
	if !ok || g.name != name {
		g = agentIcon{name: name}
		if d := s.describe(kind); d.Glyph != nil {
			g.svg = ui.MustParseSVG(d.Glyph)
		} else if r, ok := glyphLetter(name, kind); ok {
			g.letter, g.color = r, glyphColor(kind)
		} else {
			g.svg = genericGlyph
		}
		if s.glyphs == nil {
			s.glyphs = map[agent.Kind]agentIcon{}
		}
		s.glyphs[kind] = g
	}
	if g.svg != nil {
		return ui.Image(c, g.svg).Size(size, size).Shrink(0).Tooltip(name)
	}
	b := ui.Box(c).Size(size, size).Shrink(0).Radius(size / 4).Background(g.color).
		AlignItems(ui.Center).Justify(ui.Center).Tooltip(name)
	if c.Theme().Dark {
		// The edge of a dark color, on a dark background.
		b.Border(1, ui.RGBA(255, 255, 255, 0.14))
	}
	return b.Children(func() {
		ui.Text(c, string(g.letter)).Bold().FontSize(size * 0.6).TextColor(ui.RGB(255, 255, 255))
	})
}

// glyphLetter is the letter of a glyph: the first letter or digit of the
// name, or of the ID when the name is empty, compatibility forms (as
// full-width letters) folded and a leading "acp-" or "acp " dropped;
// letters in upper case. Without a letter or digit there is none.
func glyphLetter(name string, kind agent.Kind) (rune, bool) {
	n := strings.TrimSpace(norm.NFKC.String(name))
	if n == "" {
		n = strings.TrimSpace(norm.NFKC.String(string(kind)))
	}
	if len(n) > 4 && strings.EqualFold(n[:3], "acp") && (n[3] == '-' || n[3] == ' ') {
		if rest := strings.TrimSpace(n[4:]); rest != "" {
			n = rest
		}
	}
	for _, r := range n {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			return unicode.ToUpper(r), true
		}
	}
	return 0, false
}

// glyphColor is the color of an Agent's letter glyph, chosen by its ID,
// which renaming it keeps.
func glyphColor(kind agent.Kind) ui.Color {
	h := fnv.New32a()
	h.Write([]byte(kind))
	return glyphColors[h.Sum32()%uint32(len(glyphColors))]
}
