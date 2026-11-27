package workbench_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

func TestCompactionMarkers(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	_, s := newSession(t, b)
	if err := b.Compact(s.ID); !errors.Is(err, workbench.ErrNothingToCompact) {
		t.Errorf("compacting an empty session: %v", err)
	}
	converse(t, b, sc, s.ID, "一", "回复一")
	// The Agent compacts by itself, within a turn.
	b.Send(s.ID, "二")
	sc.emit(agent.ReplyDelta{ReplyID: "r", Text: "回复二"}, agent.ReplyDone{ReplyID: "r"},
		agent.Compacted{Trigger: "auto", PreTokens: 19700, PostTokens: 6300})
	sc.endTurn()
	b.idle(t, s.ID)
	// The user asks for it.
	if err := b.Compact(s.ID); err != nil {
		t.Fatal(err)
	}
	b.idle(t, s.ID)
	converse(t, b, sc, s.ID, "三")

	check := func(ms []model.Marker) {
		t.Helper()
		if len(ms) != 2 {
			t.Fatalf("markers = %+v", ms)
		}
		if m := ms[0]; m.AfterSeq != 4 || m.Kind != model.Compaction || m.Trigger != "auto" || m.PreTokens != 19700 || m.PostTokens != 6300 {
			t.Errorf("auto marker = %+v", m)
		}
		if m := ms[1]; m.AfterSeq != 4 || m.Trigger != "manual" {
			t.Errorf("manual marker = %+v", m)
		}
	}
	check(b.Markers(s.ID))
	// Markers are not messages: the numbers go on.
	if ms := b.messages(t, s.ID); len(ms) != 5 || ms[4].Seq != 5 {
		t.Errorf("messages = %+v", ms)
	}
	b.Close()
	b2 := open(t, dir, newScript().respond)
	defer b2.Close()
	check(b2.Markers(s.ID))
}

func TestSelfReference(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	_, s := newSession(t, b)
	converse(t, b, sc, s.ID, "暗号是 kestrel", "记住了")
	b.Compact(s.ID)
	b.idle(t, s.ID)
	converse(t, b, sc, s.ID, "后来的话", "后来的回复")

	r, err := b.ReferenceRange(s.ID, 1, 2, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"这是本会话较早的一段内容，你的上下文中可能已不再保留其细节", "不要凭记忆猜测细节", "- 范围：#1–#2"} {
		if !strings.Contains(r.Brief, want) {
			t.Errorf("brief lacks %q:\n%s", want, r.Brief)
		}
	}
	for _, not := range []string{"- 来源：", "- 源工作区："} {
		if strings.Contains(r.Brief, not) {
			t.Errorf("brief has %q:\n%s", not, r.Brief)
		}
	}
	converse(t, b, sc, s.ID, "我们之前定的暗号是什么？")
	_, opts := lastTurn(sc)
	text, isErr := call(t, opts, "read_reference", map[string]any{"ref_id": r.ID})
	if isErr || !strings.Contains(text, "暗号是 kestrel") || strings.Contains(text, "压缩") {
		t.Errorf("reading itself:\n%s", text)
	}
}
