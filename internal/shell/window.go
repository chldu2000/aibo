package shell

import (
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// WindowControls acts on the native window that owns this shell.
type WindowControls interface {
	Minimize()
	IsMaximized() bool
	ToggleMaximize()
	Close()
}

// SetWindowControls enables in-content controls for a window that hides its own.
func (s *Shell) SetWindowControls(w WindowControls) { s.window = w }

const (
	capsuleRight       = 16
	captionButtonWidth = 36
	capsuleWidth       = 3*captionButtonWidth + 12 // six points of padding on each side
)

func (s *Shell) windowCapsule(c *ui.Context) {
	w := s.window
	if w == nil {
		return
	}
	const height = headerBottom - headerTop
	ui.Row(c).Absolute().Top(headerTop).Right(capsuleRight).Width(capsuleWidth).Height(height).
		Radius(height/2).Padding(0, 6).AlignItems(ui.Center).Material(glass.Glass{}).DragWindow().Children(func() {
		if captionButton(c, "minus", locales.MinimizeWindow()).Clicked() {
			w.Minimize()
		}
		symbol, label := "square", locales.MaximizeWindow()
		if w.IsMaximized() {
			symbol, label = "rectangle.on.rectangle", locales.RestoreWindow()
		}
		if captionButton(c, symbol, label).MaximizeButton().Clicked() {
			w.ToggleMaximize()
		}
		if captionButton(c, "xmark", locales.CloseWindow()).Clicked() {
			// Native Close marshals to the main thread after this frame returns.
			go w.Close()
		}
	})
}

func captionButton(c *ui.Context, symbol, label string) ui.Element {
	t := c.Theme()
	b := ui.ButtonBase(c).Size(captionButtonWidth, 32).Radius(16).Label(label).Tooltip(label)
	color := t.Text
	switch {
	case symbol == "xmark" && (b.Hovered() || b.Pressed()):
		b.Background(t.Danger)
		color = ui.RGBA(255, 255, 255, 1)
	case b.Pressed():
		b.Background(t.SurfacePressed)
	case b.Hovered():
		b.Background(t.SurfaceHover)
	}
	return b.Children(func() { icon(c, symbol).Size(14).Color(color) })
}
