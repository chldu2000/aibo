package shell

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestToolbarIconPaintsInBothThemes(t *testing.T) {
	for name := range iconFallbacks {
		t.Run(name, func(t *testing.T) { checkToolbarIcon(t, name) })
	}
}

func checkToolbarIcon(t *testing.T, name string) {
	tt := ui.NewTester(func(c *ui.Context) {
		ui.Box(c).Fill().Background(c.Theme().Background).Padding(12).Children(func() {
			iconButton(c, name, "button")
		})
	}, 80, 80)
	for _, dark := range []bool{false, true} {
		tt.SetDark(dark)
		tt.Frame()
		r, ok := tt.Find(name)
		if !ok {
			t.Fatal("missing icon")
		}
		img := tt.Image()
		bg := img.RGBAAt(int(r.X)-1, int(r.Y))
		ink := 0
		for y := int(r.Y); y < int(r.Y+r.H); y++ {
			for x := int(r.X); x < int(r.X+r.W); x++ {
				if img.RGBAAt(x, y) != bg {
					ink++
				}
			}
		}
		if ink < 8 {
			t.Errorf("dark=%t: icon painted %d pixels", dark, ink)
		}
	}
}
