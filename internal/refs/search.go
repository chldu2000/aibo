package refs

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/chldu2000/aibo/internal/model"
)

// ToolSearchReference searches the references given to a session.
const ToolSearchReference = "search_reference"

// Search limits.
const (
	// HitsPerPage is the most hits a page of results shows.
	HitsPerPage = 20
	// SnippetLen is about how many characters a hit shows around its
	// match.
	SnippetLen = 200
)

// Searched is a reference to search, with its range's messages.
type Searched struct {
	Ref       model.Reference
	Messages  []model.Message
	AgentName string
}

// SearchRequest is a search of references.
type SearchRequest struct {
	Refs  []Searched
	Query string
	// Regex takes Query as a regular expression; otherwise it is words,
	// all of which a message must contain, in any case.
	Regex    bool
	Thinking bool
	Cursor   string
	ToolName func(string) string
}

// ErrBadQuery is the error of a query that cannot be searched for.
var ErrBadQuery = errors.New("bad query")

// matcher finds the query in a text, returning where its first match
// starts and ends, or -1.
type matcher func(text string) (int, int)

func newMatcher(query string, regex bool) (matcher, error) {
	if strings.TrimSpace(query) == "" {
		return nil, fmt.Errorf("%w：搜索词不能为空", ErrBadQuery)
	}
	if regex {
		re, err := regexp.Compile(query)
		if err != nil {
			return nil, fmt.Errorf("%w：正则表达式无效：%v", ErrBadQuery, err)
		}
		return func(text string) (int, int) {
			if loc := re.FindStringIndex(text); loc != nil {
				return loc[0], loc[1]
			}
			return -1, -1
		}, nil
	}
	words := strings.Fields(strings.ToLower(query))
	return func(text string) (int, int) {
		lower := strings.ToLower(text)
		start, end := -1, -1
		for _, w := range words {
			i := strings.Index(lower, w)
			if i < 0 {
				return -1, -1
			}
			if start < 0 || i < start {
				start, end = i, i+len(w)
			}
		}
		// Lowering keeps the byte offsets of ASCII and CJK text; where it
		// does not, the snippet is still near the match.
		start, end = min(start, len(text)), min(end, len(text))
		return start, end
	}, nil
}

type hit struct {
	ref     *Searched
	m       model.Message
	snippet string
}

// Search finds the messages that match the query, in the references'
// ranges, and renders a page of hits.
func Search(q SearchRequest) (string, error) {
	match, err := newMatcher(q.Query, q.Regex)
	if err != nil {
		return "", err
	}
	offset := 0
	if q.Cursor != "" {
		if offset, err = parseCursor(q.Cursor, 'h'); err != nil {
			return "", err
		}
	}
	var hits []hit
	for i := range q.Refs {
		r := &q.Refs[i]
		for _, m := range r.Messages {
			text := body(m, q.Thinking)
			if start, end := match(text); start >= 0 {
				hits = append(hits, hit{ref: r, m: m, snippet: snippet(text, start, end)})
			}
		}
	}
	var b strings.Builder
	kind := "关键词"
	if q.Regex {
		kind = "正则"
	}
	fmt.Fprintf(&b, "在 %d 个引用中按%s搜索 %q：", len(q.Refs), kind, q.Query)
	if len(hits) == 0 {
		b.WriteString("没有命中。\n")
		return b.String(), nil
	}
	if offset >= len(hits) {
		return "", fmt.Errorf("cursor %q 超出了命中数（共 %d 条）", q.Cursor, len(hits))
	}
	page := hits[offset:min(offset+HitsPerPage, len(hits))]
	fmt.Fprintf(&b, "共 %d 条消息命中，本页第 %d–%d 条。用 %s(ref_id, seq) 读取命中消息的完整内容。\n", len(hits), offset+1, offset+len(page), q.ToolName(ToolReadMessage))
	for _, h := range page {
		fmt.Fprintf(&b, "\n- %s #%d %s · %s\n  %s\n", h.ref.Ref.ID, h.m.Seq, roleName(h.m.Kind, h.ref.AgentName), h.m.CreatedAt.Local().Format("2006-01-02 15:04"), h.snippet)
	}
	if next := offset + len(page); next < len(hits) {
		fmt.Fprintf(&b, "\n（还有 %d 条命中。继续：%s(query=%q, cursor=\"h%d\")）\n", len(hits)-next, q.ToolName(ToolSearchReference), q.Query, next)
	}
	return b.String(), nil
}

// snippet is about SnippetLen characters of text around start..end, on
// one line.
func snippet(text string, start, end int) string {
	before := []rune(text[:start])
	match := text[start:end]
	after := []rune(text[end:])
	room := max(SnippetLen-utf8.RuneCountInString(match), 0)
	nb := min(len(before), room/2)
	na := min(len(after), room-nb)
	nb = min(len(before), room-na)
	s := string(before[len(before)-nb:]) + match + string(after[:na])
	s = strings.Join(strings.Fields(s), " ")
	if nb < len(before) {
		s = "……" + s
	}
	if na < len(after) {
		s += "……"
	}
	return s
}
