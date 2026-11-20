package workbench_test

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/refs"
	"github.com/chldu2000/aibo/internal/store"
	"github.com/chldu2000/aibo/internal/workbench"
)

// small budgets make pages of a few messages.
var small = refs.Budgets{Page: 60, ToolOutput: 20, MessagePage: 40}

// tenTurns makes a source session of ten user messages and ten replies,
// a receiver that got all of it, and returns the receiver's options.
func tenTurns(t *testing.T, b *bench, sc *script) (src, tgt model.Session, r model.Reference) {
	t.Helper()
	ws, src := newSession(t, b)
	for i := 1; i <= 10; i++ {
		converse(t, b, sc, src.ID, fmt.Sprintf("问题 %d", i), fmt.Sprintf("回答 %d", i))
	}
	tgt, _ = b.NewSession(ws.ID, fake.Kind, "")
	r, err := b.ReferenceSession(src.ID, tgt.ID)
	if err != nil {
		t.Fatal(err)
	}
	converse(t, b, sc, tgt.ID, "读")
	return src, tgt, r
}

var headingRE = regexp.MustCompile(`### \[(\d+)\]`)

func seqsOf(text string) []string {
	var out []string
	for _, m := range headingRE.FindAllStringSubmatch(text, -1) {
		out = append(out, m[1])
	}
	return out
}

var cursorRE = regexp.MustCompile(`cursor="([^"]+)"`)

func TestReadReferencePages(t *testing.T) {
	sc := newScript()
	b := openWith(t, t.TempDir(), sc.respond, workbench.Options{Budgets: small})
	defer b.Close()
	_, _, r := tenTurns(t, b, sc)
	_, opts := lastTurn(sc)

	// Reading page after page covers the range once, in order.
	var all []string
	cursor := ""
	for pages := 0; ; pages++ {
		if pages > 20 {
			t.Fatal("pages never end")
		}
		args := map[string]any{"ref_id": r.ID}
		if cursor != "" {
			args["cursor"] = cursor
		}
		text, isErr := call(t, opts, "read_reference", args)
		if isErr {
			t.Fatal(text)
		}
		seqs := seqsOf(text)
		if len(seqs) == 0 {
			t.Fatalf("an empty page:\n%s", text)
		}
		all = append(all, seqs...)
		m := cursorRE.FindStringSubmatch(text)
		if m == nil {
			if !strings.Contains(text, "已读完引用范围内的全部消息") {
				t.Errorf("last page does not say so:\n%s", text)
			}
			break
		}
		if !strings.Contains(text, "还剩") {
			t.Errorf("page does not say what is left:\n%s", text)
		}
		cursor = m[1]
	}
	if got := strings.Join(all, ","); got != "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20" {
		t.Errorf("pages showed %s", got)
	}

	// from_seq starts anywhere in the range; reads are recorded as read.
	text, _ := call(t, opts, "read_reference", map[string]any{"ref_id": r.ID, "from_seq": 15})
	if seqs := seqsOf(text); len(seqs) == 0 || seqs[0] != "15" {
		t.Errorf("from_seq 15 starts at %v", seqs)
	}
	got, _ := b.Reference(r.ID)
	if last := got.Reads[len(got.Reads)-1]; last.From != 15 {
		t.Errorf("last read = %+v", last)
	}
	if len(got.Reads) < 3 || got.Reads[0].From != 1 {
		t.Errorf("reads = %+v", got.Reads)
	}

	for _, args := range []map[string]any{
		{"ref_id": r.ID, "from_seq": 21},
		{"ref_id": r.ID, "cursor": "s99"},
	} {
		text, isErr := call(t, opts, "read_reference", args)
		if !isErr || !strings.Contains(text, "有效范围：#1–#20") {
			t.Errorf("%v: %q, want an error naming the range", args, text)
		}
	}
	if text, isErr := call(t, opts, "read_reference", map[string]any{"ref_id": r.ID, "cursor": "garbage"}); !isErr || !strings.Contains(text, "无效的 cursor") {
		t.Errorf("bad cursor: %q", text)
	}
}

func TestLongMessagesAreCutInPagesAndReadInFull(t *testing.T) {
	sc := newScript()
	b := openWith(t, t.TempDir(), sc.respond, workbench.Options{Budgets: small})
	defer b.Close()
	ws, src := newSession(t, b)
	long := strings.Repeat("甲乙丙丁戊己庚辛壬癸", 10) // 100 tokens
	converse(t, b, sc, src.ID, "长回复", long)
	tgt, _ := b.NewSession(ws.ID, fake.Kind, "")
	r, _ := b.ReferenceSession(src.ID, tgt.ID)
	converse(t, b, sc, tgt.ID, "读")
	_, opts := lastTurn(sc)

	page, _ := call(t, opts, "read_reference", map[string]any{"ref_id": r.ID, "from_seq": 2})
	if strings.Contains(page, long) || !strings.Contains(page, `read_message(ref_id="`+r.ID+`", seq=2)`) {
		t.Errorf("a long message in a page:\n%s", page)
	}

	var full strings.Builder
	cursor := ""
	for pages := 0; ; pages++ {
		if pages > 10 {
			t.Fatal("message pages never end")
		}
		args := map[string]any{"ref_id": r.ID, "seq": 2}
		if cursor != "" {
			args["cursor"] = cursor
		}
		text, isErr := call(t, opts, "read_message", args)
		if isErr {
			t.Fatal(text)
		}
		body := text[strings.Index(text, "### [2]"):]
		body = body[strings.Index(body, "\n\n")+2:]
		body = strings.TrimPrefix(body, "……（接上一页）\n")
		if i := strings.Index(body, "\n\n（这条消息还没完"); i >= 0 {
			body = body[:i]
		}
		full.WriteString(strings.TrimSuffix(body, "\n"))
		m := cursorRE.FindStringSubmatch(text)
		if m == nil {
			break
		}
		cursor = m[1]
	}
	if full.String() != long {
		t.Errorf("read_message pages make\n%q\nwant\n%q", full.String(), long)
	}
	if text, isErr := call(t, opts, "read_message", map[string]any{"ref_id": r.ID, "seq": 3}); !isErr || !strings.Contains(text, "有效范围：#1–#2") {
		t.Errorf("read_message out of range: %q", text)
	}
}

func TestIncludeThinking(t *testing.T) {
	dir := t.TempDir()
	// Seed a reply with reasoning, which the fake cannot stream yet.
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	ws := t.TempDir()
	st.AddWorkspace(model.Workspace{ID: "w1", Path: ws, CreatedAt: now})
	st.CreateSession(model.Session{ID: "src", WorkspaceID: "w1", Agent: fake.Kind, Title: "有思考", CreatedAt: now, ActiveAt: now})
	st.AppendMessage("src", model.Message{Kind: model.UserMessage, State: model.Done, Text: "为什么", CreatedAt: now})
	st.AppendMessage("src", model.Message{Kind: model.AgentReply, State: model.Done, Text: "因为如此", Thinking: "先想一想原因", CreatedAt: now})
	st.CreateSession(model.Session{ID: "tgt", WorkspaceID: "w1", Agent: fake.Kind, CreatedAt: now, ActiveAt: now})
	st.Close()

	sc := newScript()
	b := open(t, dir, sc.respond)
	defer b.Close()
	r, err := b.ReferenceSession("src", "tgt")
	if err != nil {
		t.Fatal(err)
	}
	converse(t, b, sc, "tgt", "读")
	_, opts := lastTurn(sc)
	for tool, at := range map[string]string{"read_reference": "from_seq", "read_message": "seq"} {
		args := map[string]any{"ref_id": r.ID, at: 2}
		without, _ := call(t, opts, tool, args)
		args["include_thinking"] = true
		with, _ := call(t, opts, tool, args)
		if strings.Contains(without, "先想一想原因") || !strings.Contains(with, "> 思考：\n> 先想一想原因") || !strings.Contains(with, "因为如此") {
			t.Errorf("%s without thinking:\n%s\nwith:\n%s", tool, without, with)
		}
	}
}

func TestReferenceRange(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	src, tgt, _ := tenTurns(t, b, sc)

	r, err := b.ReferenceRange(src.ID, 7, 10, tgt.ID)
	if err != nil {
		t.Fatal(err)
	}
	if r.From != 7 || r.To != 10 || r.Count != 4 || !strings.Contains(r.Brief, "- 范围：#7–#10，共 4 条消息") ||
		!strings.Contains(r.Brief, "- 首条用户消息：#7「问题 4」") || !strings.Contains(r.Brief, "- 末条 Agent 回复：#10「回答 5」") {
		t.Errorf("reference #7–#10 = %+v", r)
	}
	for _, bad := range [][2]int{{0, 3}, {5, 4}, {19, 21}} {
		if _, err := b.ReferenceRange(src.ID, bad[0], bad[1], tgt.ID); !errors.Is(err, workbench.ErrBadRange) {
			t.Errorf("range %v: %v, want ErrBadRange", bad, err)
		}
	}

	// The preview is the brief to be, but for the ID.
	preview, err := b.PreviewBrief(src.ID, 7, 10, workbench.Target{SessionID: tgt.ID, Agent: fake.Kind, WorkspaceID: src.WorkspaceID})
	if err != nil {
		t.Fatal(err)
	}
	if strings.ReplaceAll(preview, "ref_（发出时生成）", r.ID) != r.Brief {
		t.Errorf("preview:\n%s\nbrief:\n%s", preview, r.Brief)
	}
	other, _ := b.AddWorkspace(t.TempDir())
	if p, _ := b.PreviewBrief(src.ID, 7, 10, workbench.Target{Agent: fake.Kind, WorkspaceID: other.ID}); !strings.Contains(p, "- 源工作区：") {
		t.Errorf("preview for another workspace lacks it:\n%s", p)
	}
}

func TestNormalize(t *testing.T) {
	for _, c := range []struct {
		seqs     []int
		from, to int
		filled   bool
	}{
		{[]int{3}, 3, 3, false},
		{[]int{4, 2, 3}, 2, 4, false},
		{[]int{2, 7, 5}, 2, 7, true},
		{[]int{9, 9}, 9, 9, false},
	} {
		from, to, filled := refs.Normalize(c.seqs)
		if from != c.from || to != c.to || filled != c.filled {
			t.Errorf("Normalize(%v) = %d, %d, %v; want %d, %d, %v", c.seqs, from, to, filled, c.from, c.to, c.filled)
		}
	}
}
