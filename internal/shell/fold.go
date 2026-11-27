package shell

import (
	"math"

	"github.com/egoist/mygo/ui"
)

// fold is ui.Collapsible, as it looks, with a label of its own on what
// opens it: text shows, label names it, unique on the screen where the
// same text folds more than once (the reasoning of each reply, the
// arguments of each call).
func fold(c *ui.Context, text, label string, open *bool, fn func()) {
	t := c.Theme()
	ui.Column(c).Shrink(0).Children(func() {
		p := ui.CollapsibleBase(c, open)
		tr := p.Trigger.AlignSelf(ui.Start).AlignItems(ui.Center).Gap(t.Space(1)).
			Padding(t.Space(1), 0).PaddingStart(t.Space(0.5)).PaddingEnd(t.Space(2)).Radius(t.Radius).Label(label)
		if tr.Hovered() {
			tr.Background(t.SurfaceHover)
		}
		turn := 90 * p.Progress()
		tr.Children(func() {
			ui.Box(c).Size(t.Space(4), t.Space(4)).Shrink(0).Draw(func(pt *ui.Painter, r ui.Rect) {
				pt.StrokePath(disclosure(r, turn), 1.5, t.TextMuted)
			})
			ui.Text(c, text).SingleLine()
		})
		// Closed, the panel is no element, and styling it does nothing.
		p.Panel(fn).Padding(t.Space(1), 0).PaddingStart(t.Space(5.5)).Gap(t.Space(2))
	})
}

// disclosure is the arrow of a fold, as ui.Collapsible draws it: pointing
// right, turned by deg degrees clockwise.
func disclosure(r ui.Rect, deg float32) *ui.Path {
	cx, cy, d := r.X+r.W/2, r.Y+r.H/2, r.W/8
	sin, cos := math.Sincos(float64(deg) * math.Pi / 180)
	at := func(x, y float32) (float32, float32) {
		return cx + x*float32(cos) - y*float32(sin), cy + x*float32(sin) + y*float32(cos)
	}
	var path ui.Path
	path.MoveTo(at(-d, -2*d)).LineTo(at(d, 0)).LineTo(at(-d, 2*d))
	return &path
}
