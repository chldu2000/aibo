package workbench_test

import (
	"testing"
)

// A session that ends a turn while no window shows it is unread until
// one does; one a window shows, the main one or its own, stays read.
func TestUnread(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	_, s := newSession(t, b)
	unread := func(want bool) {
		t.Helper()
		if got := b.Status(s.ID).Unread; got != want {
			t.Errorf("unread = %v, want %v", got, want)
		}
	}

	converse(t, b, sc, s.ID, "hi", "hello")
	unread(true)
	if got := b.LastWords(s.ID); got != "hello" {
		t.Errorf("last words = %q", got)
	}
	b.Viewing("main", s.ID)
	unread(false)

	// Shown in its own window while the main one shows another.
	b.Viewing("main", "")
	b.Viewing("own", s.ID)
	converse(t, b, sc, s.ID, "again")
	unread(false)

	// Its window closed, it is unread again.
	b.Viewing("own", "")
	converse(t, b, sc, s.ID, "once more")
	unread(true)
	if got := b.LastWords(s.ID); got != "once more" {
		t.Errorf("last words = %q", got)
	}
}
