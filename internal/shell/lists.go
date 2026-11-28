package shell

import (
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

// listShows is how many rows a long list of the details shows before a
// line shows the others: a frame of a thousand rows takes some 6ms to
// build (.scratch/ui-polish/issues/20-inspector-lists.md).
const listShows = 100

// shownOf is how many of n rows a list shows, all of them or listShows.
func shownOf(n int, all bool) int {
	if all {
		return n
	}
	return min(n, listShows)
}

// moreLine is the line under a list longer than listShows: how many rows
// it hides, which shows them, or, all shown, one to show fewer. group
// names the list in the line's label, unique on the screen. It reports
// a click.
func moreLine(c *ui.Context, key string, n int, all bool, group string) bool {
	if n <= listShows {
		return false
	}
	t := c.Theme()
	text, label := locales.MoreItems(n-listShows), locales.MoreItemsLabel(n-listShows, group)
	if all {
		text, label = locales.FewerItems(), locales.FewerItemsLabel(group)
	}
	line := ui.Row(c).Key(key).Padding(4, 8).Radius(7).Label(label).Cursor(ui.CursorPointer).Children(func() {
		ui.Text(c, text).FontSize(12).TextColor(t.TextMuted)
	})
	if line.Hovered() {
		line.Background(t.SurfaceHover)
	}
	return line.Clicked()
}
