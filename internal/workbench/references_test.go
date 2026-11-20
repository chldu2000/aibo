package workbench_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

// converse runs one turn in session id: the user's text, then the
// Agent's replies.
func converse(t *testing.T, b *bench, sc *script, id, text string, replies ...string) {
	t.Helper()
	if err := b.Send(id, text); err != nil {
		t.Fatal(err)
	}
	for i, r := range replies {
		rid := string(rune('a' + i))
		sc.emit(agent.ReplyDelta{ReplyID: rid, Text: r}, agent.ReplyDone{ReplyID: rid})
	}
	sc.endTurn()
	b.idle(t, id)
}

// call calls a workbench MCP tool as the Agent of the session whose
// options are opts.
func call(t *testing.T, opts agent.StartOptions, tool string, args map[string]any) (string, bool) {
	t.Helper()
	text, isErr, err := fake.CallTool(context.Background(), opts.MCP, tool, args)
	if err != nil {
		t.Fatalf("%s: %v", tool, err)
	}
	return text, isErr
}

func lastTurn(sc *script) (agent.Turn, agent.StartOptions) {
	turns, opts := sc.received()
	return turns[len(turns)-1], opts
}

func TestPushWholeSessionReference(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, src := newSession(t, b)
	converse(t, b, sc, src.ID, "我们要把 orders 表迁到 Postgres，先梳理风险。", "主要风险有三点：ENUM、时区、自增 ID。")
	converse(t, b, sc, src.ID, "好，那就定方案：双写 + 回填。", "方案已写进 docs/migration.md。")
	tgt, _ := b.NewSession(ws.ID, fake.Kind, "")

	r, err := b.ReferenceSession(src.ID, tgt.ID)
	if err != nil {
		t.Fatal(err)
	}
	if r.From != 1 || r.To != 4 || r.Count != 4 || r.State != model.Draft || r.TargetID != tgt.ID || !strings.HasPrefix(r.ID, "ref_") {
		t.Fatalf("reference = %+v", r)
	}
	for _, want := range []string{
		`<aibo-reference id="` + r.ID + `">`,
		"请先调用 read_reference 读取",
		"- 来源：「我们要把 orders 表迁到 Postgres，先梳理风险。」· 假 Agent",
		"- 范围：#1–#4，共 4 条消息",
		"- 首条用户消息：#1「我们要把 orders 表迁到 Postgres，先梳理风险。」",
		"- 末条 Agent 回复：#4「方案已写进 docs/migration.md。」",
		`- 可用工具：read_reference(ref_id="` + r.ID + `")、read_message、search_reference、list_references`,
	} {
		if !strings.Contains(r.Brief, want) {
			t.Errorf("brief lacks %q:\n%s", want, r.Brief)
		}
	}
	if strings.Contains(r.Brief, "源工作区") {
		t.Errorf("brief of a reference within one workspace names it:\n%s", r.Brief)
	}
	if d := b.Drafts(tgt.ID); len(d) != 1 || d[0].ID != r.ID {
		t.Fatalf("drafts = %+v", d)
	}

	// Sent with the user's words, the brief precedes them.
	converse(t, b, sc, tgt.ID, "按这个方案写回填脚本", "好的。")
	turn, _ := lastTurn(sc)
	if want := r.Brief + "\n\n按这个方案写回填脚本"; turn.Text != want {
		t.Errorf("the Agent received:\n%s\nwant:\n%s", turn.Text, want)
	}
	msgs := b.messages(t, tgt.ID)
	if msgs[0].Text != "按这个方案写回填脚本" || len(msgs[0].Refs) != 1 || msgs[0].Refs[0] != r.ID {
		t.Errorf("user message = %+v, want the user's words and the reference", msgs[0])
	}
	if d := b.Drafts(tgt.ID); len(d) != 0 {
		t.Errorf("drafts after sending: %+v", d)
	}
	got, _ := b.Reference(r.ID)
	if got.State != model.Delivered || got.MessageSeq != 1 {
		t.Errorf("after sending: %+v", got)
	}
}

func TestReadReferenceThroughMCP(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, src := newSession(t, b)
	converse(t, b, sc, src.ID, "梳理风险", "风险有三点。")
	tgt, _ := b.NewSession(ws.ID, fake.Kind, "")
	r, _ := b.ReferenceSession(src.ID, tgt.ID)
	converse(t, b, sc, tgt.ID, "看看引用")
	_, opts := lastTurn(sc)

	list, isErr := call(t, opts, "list_references", nil)
	if isErr || !strings.Contains(list, "共 1 个") || !strings.Contains(list, r.Brief) {
		t.Errorf("list_references = %q", list)
	}
	text, isErr := call(t, opts, "read_reference", map[string]any{"ref_id": r.ID})
	if isErr {
		t.Fatalf("read_reference failed: %s", text)
	}
	for _, want := range []string{
		"引用 " + r.ID + "：「梳理风险」#1–#2，共 2 条消息",
		"文件可能已在引用之后被修改",
		"### [1] 用户 · ",
		"梳理风险",
		"### [2] 假 Agent 回复 · ",
		"风险有三点。",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("read_reference lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "源工作区") {
		t.Errorf("read within one workspace names the source workspace:\n%s", text)
	}
	b.waitFor(t, "the read to be recorded", func() bool {
		got, _ := b.Reference(r.ID)
		return len(got.Reads) == 1
	})
	got, _ := b.Reference(r.ID)
	if rd := got.Reads[0]; rd.From != 1 || rd.To != 2 {
		t.Errorf("read = %+v, want #1–#2", rd)
	}
}

func TestReferenceIsASnapshot(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, src := newSession(t, b)
	converse(t, b, sc, src.ID, "第一轮", "回复一")
	tgt, _ := b.NewSession(ws.ID, fake.Kind, "")
	r, _ := b.ReferenceSession(src.ID, tgt.ID)
	converse(t, b, sc, src.ID, "后来的内容", "后来的回复")
	converse(t, b, sc, tgt.ID, "读一下")
	_, opts := lastTurn(sc)
	text, _ := call(t, opts, "read_reference", map[string]any{"ref_id": r.ID})
	if strings.Contains(text, "后来的") || !strings.Contains(text, "回复一") {
		t.Errorf("read shows more than the snapshot:\n%s", text)
	}
	if got, _ := b.Reference(r.ID); got.Brief != r.Brief || got.To != 2 {
		t.Errorf("reference changed: %+v", got)
	}
}

func TestOnlyEndedMessagesAreReferenced(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, src := newSession(t, b)
	tgt, _ := b.NewSession(ws.ID, fake.Kind, "")
	if _, err := b.ReferenceSession(src.ID, tgt.ID); !errors.Is(err, workbench.ErrNothingToRef) {
		t.Errorf("referencing an empty session: %v", err)
	}
	b.Send(src.ID, "写个长回复")
	sc.emit(agent.ReplyDelta{ReplyID: "r", Text: "写到一半"})
	b.waitFor(t, "the reply to start", func() bool { return len(b.messages(t, src.ID)) == 2 })
	r, err := b.ReferenceSession(src.ID, tgt.ID)
	if err != nil {
		t.Fatal(err)
	}
	if r.From != 1 || r.To != 1 || r.Count != 1 {
		t.Errorf("reference of a streaming session = #%d–#%d (%d), want only #1", r.From, r.To, r.Count)
	}
	if !strings.Contains(r.Brief, "- 唯一的消息：#1「写个长回复」") {
		t.Errorf("brief:\n%s", r.Brief)
	}
	sc.endTurn()
	b.idle(t, src.ID)
}

func TestBriefRules(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, src := newSession(t, b)
	long := strings.Repeat("很长的内容", 300)
	converse(t, b, sc, src.ID, long, long)
	b.Send(src.ID, "再来")
	sc.emit(agent.ReplyDelta{ReplyID: "r", Text: "被打断的回复"})
	b.waitFor(t, "the reply", func() bool { return len(b.messages(t, src.ID)) == 4 })
	b.Stop(src.ID)
	b.idle(t, src.ID)

	// Another workspace receives it.
	other, err := b.AddWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tgt, _ := b.NewSession(other.ID, fake.Kind, "")
	r, err := b.ReferenceSession(src.ID, tgt.ID)
	if err != nil {
		t.Fatal(err)
	}
	if n := utf8.RuneCountInString(r.Brief); n > 1500 {
		t.Errorf("brief is %d characters, more than 1500", n)
	}
	for _, want := range []string{
		"- 源工作区：" + ws.Path + "（不是你当前的工作区",
		"- 首条用户消息：#1「很长的内容",
		"- 末条 Agent 回复：#4「被打断的回复（已中断）」",
		"……」", // the long excerpt is cut
	} {
		if !strings.Contains(r.Brief, want) {
			t.Errorf("brief lacks %q:\n%s", want, r.Brief)
		}
	}
	converse(t, b, sc, tgt.ID, "读")
	_, opts := lastTurn(sc)
	text, _ := call(t, opts, "read_reference", map[string]any{"ref_id": r.ID})
	if !strings.Contains(text, "源工作区："+ws.Path) || !strings.Contains(text, "### [4] 假 Agent 回复（已中断）") {
		t.Errorf("cross-workspace read:\n%s", text)
	}
}

func TestBriefWithoutUserMessageOrReply(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, src := newSession(t, b)
	converse(t, b, sc, src.ID, "只有用户消息")
	converse(t, b, sc, src.ID, "第二条")
	tgt, _ := b.NewSession(ws.ID, fake.Kind, "")
	r, _ := b.ReferenceSession(src.ID, tgt.ID)
	if !strings.Contains(r.Brief, "- 首条消息：#1「只有用户消息」") || !strings.Contains(r.Brief, "- 末条消息：#2「第二条」") {
		t.Errorf("brief:\n%s", r.Brief)
	}
}

func TestReadBoundaries(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, src := newSession(t, b)
	converse(t, b, sc, src.ID, "源内容", "源回复")
	tgt, _ := b.NewSession(ws.ID, fake.Kind, "")
	bystander, _ := b.NewSession(ws.ID, fake.Kind, "")
	r, _ := b.ReferenceSession(src.ID, tgt.ID)
	draft, _ := b.ReferenceSession(src.ID, bystander.ID)

	// The bystander receives its reference; tgt receives r, and then
	// has a draft r2 it has not sent.
	converse(t, b, sc, bystander.ID, "")
	converse(t, b, sc, tgt.ID, "读")
	_, tgtOpts := lastTurn(sc)
	r2, _ := b.ReferenceSession(src.ID, tgt.ID) // a new draft for tgt

	cases := []struct {
		name, ref, want string
	}{
		{"another session's reference", draft.ID, "本会话没有 ID 为"},
		{"an unknown reference", "ref_nope", "本会话没有 ID 为"},
		{"a draft not yet sent", r2.ID, "本会话没有 ID 为"},
	}
	for _, c := range cases {
		text, isErr := call(t, tgtOpts, "read_reference", map[string]any{"ref_id": c.ref})
		if !isErr || !strings.Contains(text, c.want) {
			t.Errorf("%s: %q (error %v), want an error with %q", c.name, text, isErr, c.want)
		}
	}
	if text, isErr := call(t, tgtOpts, "read_reference", map[string]any{"ref_id": r.ID}); isErr {
		t.Errorf("its own reference: %s", text)
	}
}

func TestReferenceAfterSourceDeleted(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, src := newSession(t, b)
	converse(t, b, sc, src.ID, "将被删除", "好")
	tgt, _ := b.NewSession(ws.ID, fake.Kind, "")
	r, _ := b.ReferenceSession(src.ID, tgt.ID)
	converse(t, b, sc, tgt.ID, "读")
	_, opts := lastTurn(sc)
	if err := b.DeleteSession(src.ID); err != nil {
		t.Fatal(err)
	}
	text, isErr := call(t, opts, "read_reference", map[string]any{"ref_id": r.ID})
	if !isErr || !strings.Contains(text, "引用的源会话已被删除") {
		t.Errorf("read after deleting the source: %q", text)
	}
	if _, ok := b.Reference(r.ID); !ok {
		t.Error("deleting the source deleted the reference too")
	}

	// Deleting the receiver deletes what it received, and its token.
	if err := b.DeleteSession(tgt.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := b.Reference(r.ID); ok {
		t.Error("the receiver's reference outlived it")
	}
	if _, _, err := fake.CallTool(context.Background(), opts.MCP, "list_references", nil); err == nil {
		t.Error("a deleted session's token still works")
	}
}

func TestMCPRejectsBadTokensAndOrigins(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	_, s := newSession(t, b)
	converse(t, b, sc, s.ID, "hi")
	_, opts := lastTurn(sc)

	bad := *opts.MCP
	bad.Token = "forged"
	if _, _, err := fake.CallTool(context.Background(), &bad, "list_references", nil); err == nil {
		t.Error("a forged token works")
	}
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
	for origin, want := range map[string]int{"https://evil.example": http.StatusForbidden, "": http.StatusOK, "http://127.0.0.1:1234": http.StatusOK} {
		req, _ := http.NewRequest("POST", opts.MCP.URL, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+opts.MCP.Token)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		req.Header.Set("Mcp-Protocol-Version", "2025-06-18")
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != want {
			t.Errorf("Origin %q: status %d, want %d", origin, res.StatusCode, want)
		}
	}
}

func TestSeveralReferencesAndRemovingADraft(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, a := newSession(t, b)
	converse(t, b, sc, a.ID, "会话甲", "甲的回复")
	c, _ := b.NewSession(ws.ID, fake.Kind, "")
	converse(t, b, sc, c.ID, "会话乙", "乙的回复")
	tgt, _ := b.NewSession(ws.ID, fake.Kind, "")
	r1, _ := b.ReferenceSession(a.ID, tgt.ID)
	gone, _ := b.ReferenceSession(c.ID, tgt.ID)
	r2, _ := b.ReferenceSession(c.ID, tgt.ID)
	if err := b.RemoveDraft(gone.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := b.Reference(gone.ID); ok {
		t.Error("removed draft still exists")
	}

	// A message of references alone is fine.
	converse(t, b, sc, tgt.ID, "")
	turn, _ := lastTurn(sc)
	if want := r1.Brief + "\n\n" + r2.Brief; turn.Text != want {
		t.Errorf("the Agent received:\n%s\nwant both blocks in order", turn.Text)
	}
	if m := b.messages(t, tgt.ID)[0]; m.Text != "" || len(m.Refs) != 2 || m.Refs[0] != r1.ID || m.Refs[1] != r2.ID {
		t.Errorf("message = %+v", m)
	}
	if got, _ := b.Session(tgt.ID); got.Title != "" {
		t.Errorf("a message of references alone titled the session %q", got.Title)
	}
}

func TestReferencesSurviveRestart(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	ws, src := newSession(t, b)
	converse(t, b, sc, src.ID, "要记住的", "记住了")
	tgt, _ := b.NewSession(ws.ID, fake.Kind, "")
	r, _ := b.ReferenceSession(src.ID, tgt.ID)
	converse(t, b, sc, tgt.ID, "读一下")
	_, opts := lastTurn(sc)
	call(t, opts, "read_reference", map[string]any{"ref_id": r.ID})
	draft, _ := b.ReferenceSession(src.ID, tgt.ID)
	b.Close()

	sc2 := newScript()
	b2 := open(t, dir, sc2.respond)
	defer b2.Close()
	got, ok := b2.Reference(r.ID)
	if !ok || got.State != model.Delivered || got.Brief != r.Brief || len(got.Reads) != 1 {
		t.Fatalf("reference after restart = %+v", got)
	}
	if m := b2.messages(t, tgt.ID)[0]; len(m.Refs) != 1 || m.Refs[0] != r.ID {
		t.Errorf("message after restart = %+v", m)
	}
	if d := b2.Drafts(tgt.ID); len(d) != 1 || d[0].ID != draft.ID {
		t.Errorf("drafts after restart = %+v", d)
	}
	// The resumed session gets a new token; the old one is dead.
	converse(t, b2, sc2, tgt.ID, "再读")
	_, opts2 := lastTurn(sc2)
	if opts2.MCP.Token == opts.MCP.Token {
		t.Error("the token did not change")
	}
	if text, isErr := call(t, opts2, "read_reference", map[string]any{"ref_id": r.ID}); isErr {
		t.Errorf("read after restart: %s", text)
	}
}
