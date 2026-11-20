package workbench_test

import (
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/store"
)

var hitRE = regexp.MustCompile(`- (ref_\w+) #(\d+) `)

// hitsOf lists a page's hits as "ref#seq".
func hitsOf(text string) []string {
	var out []string
	for _, m := range hitRE.FindAllStringSubmatch(text, -1) {
		out = append(out, m[1]+"#"+m[2])
	}
	return out
}

func TestSearchReference(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, a := newSession(t, b)
	converse(t, b, sc, a.ID, "orders 表要迁到 Postgres", "迁移的风险：ENUM、Timezone、自增 ID")
	converse(t, b, sc, a.ID, "时区怎么处理", "统一转成 timestamptz，Timezone 按 UTC")
	c, _ := b.NewSession(ws.ID, fake.Kind, "")
	converse(t, b, sc, c.ID, "前端的时区显示", "用浏览器的 timezone 显示")
	tgt, _ := b.NewSession(ws.ID, fake.Kind, "")
	r1, _ := b.ReferenceRange(a.ID, 1, 3, tgt.ID) // not #4
	r2, _ := b.ReferenceSession(c.ID, tgt.ID)
	converse(t, b, sc, tgt.ID, "搜一下")
	_, opts := lastTurn(sc)
	search := func(args map[string]any) (string, bool) {
		t.Helper()
		return call(t, opts, "search_reference", args)
	}

	cases := []struct {
		name string
		args map[string]any
		want string
	}{
		{"words in any case, across references", map[string]any{"query": "timezone"}, r1.ID + "#2," + r2.ID + "#2"}, // #4 is outside r1's range
		{"every word must appear", map[string]any{"query": "timezone utc"}, ""},                                     // only #4 has both
		{"every word must appear, in range", map[string]any{"query": "风险 enum"}, r1.ID + "#2"},
		{"one reference", map[string]any{"query": "时区", "ref_id": r2.ID}, r2.ID + "#1"},
		{"regex", map[string]any{"query": `自增\s*ID|timestamptz`, "regex": true}, r1.ID + "#2"},
	}
	for _, c := range cases {
		text, isErr := search(c.args)
		if isErr {
			t.Errorf("%s: %s", c.name, text)
			continue
		}
		if got := strings.Join(hitsOf(text), ","); got != c.want {
			t.Errorf("%s: hits %q, want %q\n%s", c.name, got, c.want, text)
		}
	}
	text, _ := search(map[string]any{"query": "风险 enum"})
	if !strings.Contains(text, "迁移的风险：ENUM、Timezone、自增 ID") || !strings.Contains(text, "#2 假 Agent 回复 · ") {
		t.Errorf("hit lacks its snippet or role:\n%s", text)
	}
	if text, _ := search(map[string]any{"query": "不存在的词"}); !strings.Contains(text, "没有命中") {
		t.Errorf("no hits: %q", text)
	}
	for name, args := range map[string]map[string]any{
		"empty query":       {"query": "  "},
		"invalid regex":     {"query": "(", "regex": true},
		"another reference": {"query": "x", "ref_id": "ref_nope"},
		"bad cursor":        {"query": "timezone", "cursor": "h99"},
	} {
		if text, isErr := search(args); !isErr {
			t.Errorf("%s: no error: %q", name, text)
		}
	}
	// Searching records no reads.
	if got, _ := b.Reference(r1.ID); len(got.Reads) != 0 {
		t.Errorf("search recorded reads: %+v", got.Reads)
	}
}

func TestSearchPagesAndThinking(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	ws := t.TempDir()
	st.AddWorkspace(model.Workspace{ID: "w1", Path: ws, CreatedAt: now})
	st.CreateSession(model.Session{ID: "src", WorkspaceID: "w1", Agent: fake.Kind, Title: "很多命中", CreatedAt: now, ActiveAt: now})
	for i := 1; i <= 25; i++ {
		st.AppendMessage("src", model.Message{Kind: model.AgentReply, State: model.Done, Text: fmt.Sprintf("第 %d 条：命中词 %s", i, strings.Repeat("填充", 200)), CreatedAt: now})
	}
	st.AppendMessage("src", model.Message{Kind: model.AgentReply, State: model.Done, Text: "回复", Thinking: "藏在思考里的线索", CreatedAt: now})
	st.CreateSession(model.Session{ID: "tgt", WorkspaceID: "w1", Agent: fake.Kind, CreatedAt: now, ActiveAt: now})
	st.Close()

	sc := newScript()
	b := open(t, dir, sc.respond)
	defer b.Close()
	r, _ := b.ReferenceSession("src", "tgt")
	converse(t, b, sc, "tgt", "搜")
	_, opts := lastTurn(sc)

	first, _ := call(t, opts, "search_reference", map[string]any{"query": "命中词"})
	if n := len(hitsOf(first)); n != 20 || !strings.Contains(first, "共 25 条消息命中") || !strings.Contains(first, "还有 5 条命中") {
		t.Errorf("first page has %d hits:\n%.400s", n, first)
	}
	m := cursorRE.FindStringSubmatch(first)
	if m == nil {
		t.Fatalf("no cursor:\n%s", first)
	}
	second, _ := call(t, opts, "search_reference", map[string]any{"query": "命中词", "cursor": m[1]})
	if got := hitsOf(second); len(got) != 5 || got[0] != r.ID+"#21" {
		t.Errorf("second page = %v", got)
	}
	// Snippets are about 200 characters, around the match.
	for _, line := range strings.Split(first, "\n") {
		if strings.HasPrefix(line, "  ") && len([]rune(line)) > 220 {
			t.Errorf("snippet of %d characters: %q", len([]rune(line)), line)
			break
		}
	}

	if text, _ := call(t, opts, "search_reference", map[string]any{"query": "线索"}); len(hitsOf(text)) != 0 {
		t.Errorf("thinking searched by default:\n%s", text)
	}
	if text, _ := call(t, opts, "search_reference", map[string]any{"query": "线索", "include_thinking": true}); strings.Join(hitsOf(text), ",") != r.ID+"#26" {
		t.Errorf("thinking not searched when asked:\n%s", text)
	}
}
