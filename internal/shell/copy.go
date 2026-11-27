package shell

import (
	"time"

	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

// copiedFor is how long a copy control says it copied.
const copiedFor = 1500 * time.Millisecond

// copied is the copy control last clicked, by its label, and when.
type copied struct {
	label string
	at    time.Time
}

// justCopied reports whether the control labelled label copied a moment
// ago, and has the window drawn again as the moment ends.
func (s *Shell) justCopied(c *ui.Context, label string) bool {
	if s.copied.label != label {
		return false
	}
	left := copiedFor - c.Now().Sub(s.copied.at)
	if left <= 0 {
		s.copied = copied{}
		return false
	}
	c.After(left)
	return true
}

// copy writes text to the clipboard, for the control labelled label to
// say so.
func (s *Shell) copy(c *ui.Context, label, text string) {
	c.WriteClipboard(text)
	s.copied = copied{label, c.Now()}
	c.After(0)
}

// copyButton is an icon button labelled label that copies text: for a
// moment after, it shows a check and says it copied. Its label stays, for
// the Tester to find it by.
func (s *Shell) copyButton(c *ui.Context, label, text string) {
	symbol, tip := "doc.on.doc", label
	if s.justCopied(c, label) {
		symbol, tip = "checkmark", locales.Copied()
	}
	if iconButton(c, symbol, tip).Label(label).Clicked() {
		s.copy(c, label, text)
	}
}

// copyTextButton is copyButton as a button of words: for a moment after,
// they say it copied. text is what it copies, worked out on the click.
func (s *Shell) copyTextButton(c *ui.Context, label string, disabled bool, text func() string) {
	words := label
	if s.justCopied(c, label) {
		words = locales.Copied()
	}
	if ui.Button(c, words).Label(label).Disabled(disabled).Clicked() && !disabled {
		s.copy(c, label, text())
	}
}
