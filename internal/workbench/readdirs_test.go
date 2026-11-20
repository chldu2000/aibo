package workbench_test

import (
	"slices"
	"testing"

	"github.com/chldu2000/aibo/internal/agent/fake"
)

func TestReadDirsFromOtherWorkspaces(t *testing.T) {
	for _, restarts := range []bool{true, false} {
		dir := t.TempDir()
		sc := newScript()
		b := open(t, dir, sc.respond)
		b.fake.RestartsForDirs = restarts
		home, src := newSession(t, b)
		converse(t, b, sc, src.ID, "同一工作区的讨论", "好")
		other, _ := b.AddWorkspace(t.TempDir())
		far, _ := b.NewSession(other.ID, fake.Kind, "")
		converse(t, b, sc, far.ID, "另一个工作区的讨论", "好")
		tgt, _ := b.NewSession(home.ID, fake.Kind, "")
		converse(t, b, sc, tgt.ID, "开始") // its native session runs
		starts := len(b.fake.Starts())

		// From its own workspace: nothing to add.
		b.ReferenceSession(src.ID, tgt.ID)
		converse(t, b, sc, tgt.ID, "读")
		if x, _ := b.Session(tgt.ID); len(x.ReadDirs) != 0 || len(b.fake.Starts()) != starts {
			t.Fatalf("a reference from its own workspace: %v, %d starts", x.ReadDirs, len(b.fake.Starts())-starts)
		}
		// From another: it may read that workspace, from this turn on.
		b.ReferenceSession(far.ID, tgt.ID)
		converse(t, b, sc, tgt.ID, "读另一个")
		x, _ := b.Session(tgt.ID)
		if !slices.Equal(x.ReadDirs, []string{other.Path}) {
			t.Errorf("read dirs = %v", x.ReadDirs)
		}
		st := b.fake.Starts()
		if restarts {
			if len(st) != starts+1 || !slices.Equal(st[len(st)-1].ReadDirs, []string{other.Path}) || st[len(st)-1].ResumeID == "" {
				t.Errorf("not restarted with the dir: %+v", st[starts:])
			}
		} else if len(st) != starts {
			t.Errorf("an Agent that needs no restart restarted")
		}
		// Again from there: nothing new.
		b.ReferenceSession(far.ID, tgt.ID)
		converse(t, b, sc, tgt.ID, "再读")
		if n := len(b.fake.Starts()); n != len(st) {
			t.Errorf("restarted again")
		}
		b.Close()
		b2 := open(t, dir, newScript().respond)
		if x, _ := b2.Session(tgt.ID); !slices.Equal(x.ReadDirs, []string{other.Path}) {
			t.Errorf("after restart: %v", x.ReadDirs)
		}
		b2.Close()
	}
}
