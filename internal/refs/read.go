package refs

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/chldu2000/aibo/internal/model"
)

// ToolReadMessage reads one message of a reference in full.
const ToolReadMessage = "read_message"

// Budgets are how much the read tools return at a time, in estimated
// tokens.
type Budgets struct {
	// Page is a read_reference page.
	Page int
	// ToolOutput is the most of one tool call's output a page keeps.
	ToolOutput int
	// MessagePage is a read_message page.
	MessagePage int
}

// DefaultBudgets are the budgets unless the user changes them.
var DefaultBudgets = Budgets{Page: 8000, ToolOutput: 2000, MessagePage: 25000}

// EstimateTokens estimates the tokens text costs a model, with no
// tokenizer at hand: a token per CJK character (or other wide script),
// and one per four bytes of the rest.
func EstimateTokens(text string) int {
	wide, rest := 0, 0
	for _, r := range text {
		if r >= 0x2E80 && (unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) || unicode.Is(unicode.Hangul, r) || r >= 0x3000 && r <= 0x303F || r >= 0xFF00 && r <= 0xFFEF) {
			wide++
		} else {
			rest += utf8.RuneLen(r)
		}
	}
	return wide + (rest+3)/4
}

// cutTokens returns the longest start of text that fits in budget tokens,
// and its length in runes.
func cutTokens(text string, budget int) (string, int) {
	if EstimateTokens(text) <= budget {
		return text, utf8.RuneCountInString(text)
	}
	r := []rune(text)
	lo, hi := 0, len(r)
	for lo < hi {
		mid := (lo + hi + 1) / 2
		if EstimateTokens(string(r[:mid])) <= budget {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	return string(r[:lo]), lo
}

// ReadRequest is a read of a reference's range.
type ReadRequest struct {
	// Ref is the reference read; Messages are its range's messages.
	Ref      model.Reference
	Messages []model.Message
	// FromSeq starts the page at a sequence number; Cursor, from an
	// earlier page, wins over it. Both zero start at the beginning.
	FromSeq int
	Cursor  string
	// Thinking includes the Agent's reasoning.
	Thinking bool
	// AgentName names the source Agent; ToolName names a tool as the
	// reader sees it; Header starts the text.
	AgentName string
	ToolName  func(string) string
	Header    string
	Budgets   Budgets
}

// Read is what a read returns: Text for the reader, and the range of
// messages it showed, for the read records.
type Read struct {
	Text     string
	From, To int
}

// ErrOutOfRange is the error of a sequence number outside a reference.
var ErrOutOfRange = errors.New("out of range")

func rangeError(r model.Reference, seq int) error {
	return fmt.Errorf("%w：序号 #%d 不在引用 %s 的范围内。有效范围：%s。", ErrOutOfRange, seq, r.ID, Range(r.From, r.To))
}

// ReadPage renders a page of a reference: messages from the start until
// the page budget, at least one, each message's body cut to fit.
func ReadPage(q ReadRequest) (Read, error) {
	start := q.Ref.From
	switch {
	case q.Cursor != "":
		seq, err := parseCursor(q.Cursor, 's')
		if err != nil {
			return Read{}, err
		}
		start = seq
	case q.FromSeq != 0:
		start = q.FromSeq
	}
	if start < q.Ref.From || start > q.Ref.To {
		return Read{}, rangeError(q.Ref, start)
	}
	i := 0
	for i < len(q.Messages) && q.Messages[i].Seq < start {
		i++
	}
	var b strings.Builder
	b.WriteString(q.Header)
	used := EstimateTokens(q.Header)
	first, last := i, i
	for ; i < len(q.Messages); i++ {
		m := q.Messages[i]
		limit := q.Budgets.Page
		if m.Kind == model.ToolCall {
			limit = q.Budgets.ToolOutput
		}
		text := message(m, q, limit)
		cost := EstimateTokens(text)
		if i > first && used+cost > q.Budgets.Page {
			break
		}
		b.WriteString(text)
		used += cost
		last = i
	}
	read := Read{From: q.Messages[first].Seq, To: q.Messages[last].Seq}
	if left := len(q.Messages) - 1 - last; left > 0 {
		next := q.Messages[last+1].Seq
		fmt.Fprintf(&b, "\n（本页到 #%d 为止，还剩 %d 条。继续读取：%s(ref_id=%q, cursor=\"s%d\")）\n", read.To, left, q.ToolName(ToolReadReference), q.Ref.ID, next)
	} else {
		b.WriteString("\n（已读完引用范围内的全部消息）\n")
	}
	read.Text = b.String()
	return read, nil
}

// message renders one message, its body cut to limit tokens.
func message(m model.Message, q ReadRequest, limit int) string {
	body := body(m, q.Thinking)
	if cut, _ := cutTokens(body, limit); cut != body {
		body = fmt.Sprintf("%s\n……（这条消息约 %d token，此处只显示开头；完整内容用 %s(ref_id=%q, seq=%d) 读取）", cut, EstimateTokens(body), q.ToolName(ToolReadMessage), q.Ref.ID, m.Seq)
	}
	return heading(m, q.AgentName) + body + "\n"
}

func heading(m model.Message, agentName string) string {
	role := roleName(m.Kind, agentName)
	if m.CommandOutput {
		role = agentName + " 命令输出"
	}
	if m.State == model.Interrupted {
		role += "（已中断）"
	}
	h := fmt.Sprintf("\n### [%d] %s · %s\n\n", m.Seq, role, m.CreatedAt.Local().Format("2006-01-02 15:04"))
	if c := m.Command; c != nil {
		// What the command was said to do as it was sent: what it expanded
		// to, the Agent alone knows.
		if c.Description != "" {
			h += fmt.Sprintf("（调用了 %s 的命令 /%s：%s）\n\n", agentName, c.Name, c.Description)
		} else {
			h += fmt.Sprintf("（调用了 %s 的命令 /%s）\n\n", agentName, c.Name)
		}
	}
	return h
}

// body is a message's text, after its reasoning when asked for. A tool
// call's is its name, a summary of its input and its result, with the
// messages of the subagent it ran.
func body(m model.Message, thinking bool) string {
	text := strings.TrimRight(said(m), "\n")
	if m.Kind == model.ToolCall && m.Tool != nil {
		text = toolText(m, thinking)
	}
	for _, a := range m.Attachments {
		// The image itself stays with its session: its name only.
		text += "\n[图片: " + a.Name + "]"
	}
	text = strings.TrimLeft(text, "\n")
	if thinking && strings.TrimSpace(m.Thinking) != "" {
		quoted := "> " + strings.ReplaceAll(strings.TrimSpace(m.Thinking), "\n", "\n> ")
		text = "> 思考：\n" + quoted + "\n\n" + text
	}
	return text
}

// MessageRequest is a read of one message of a reference.
type MessageRequest struct {
	Ref       model.Reference
	Message   *model.Message // nil when Seq is not in the range
	Seq       int
	Cursor    string
	Thinking  bool
	AgentName string
	ToolName  func(string) string
	Header    string
	Budgets   Budgets
}

// ReadMessage renders one message in full, a page of MessagePage tokens
// at a time.
func ReadMessage(q MessageRequest) (Read, error) {
	if q.Seq < q.Ref.From || q.Seq > q.Ref.To || q.Message == nil {
		return Read{}, rangeError(q.Ref, q.Seq)
	}
	offset := 0
	if q.Cursor != "" {
		o, err := parseCursor(q.Cursor, 'o')
		if err != nil {
			return Read{}, err
		}
		offset = o
	}
	all := []rune(body(*q.Message, q.Thinking))
	if offset > len(all) {
		return Read{}, fmt.Errorf("cursor %q 超出了这条消息的长度", q.Cursor)
	}
	chunk, n := cutTokens(string(all[offset:]), q.Budgets.MessagePage)
	if n == 0 && offset < len(all) {
		chunk, n = string(all[offset]), 1
	}
	var b strings.Builder
	b.WriteString(q.Header)
	b.WriteString(heading(*q.Message, q.AgentName))
	if offset > 0 {
		b.WriteString("……（接上一页）\n")
	}
	b.WriteString(chunk + "\n")
	if end := offset + n; end < len(all) {
		fmt.Fprintf(&b, "\n（这条消息还没完，继续读取：%s(ref_id=%q, seq=%d, cursor=\"o%d\")）\n", q.ToolName(ToolReadMessage), q.Ref.ID, q.Seq, end)
	}
	return Read{Text: b.String(), From: q.Seq, To: q.Seq}, nil
}

func parseCursor(c string, kind byte) (int, error) {
	if len(c) < 2 || c[0] != kind {
		return 0, fmt.Errorf("无效的 cursor %q：请使用上一页末尾给出的 cursor", c)
	}
	n, err := strconv.Atoi(c[1:])
	if err != nil || n < 0 {
		return 0, fmt.Errorf("无效的 cursor %q：请使用上一页末尾给出的 cursor", c)
	}
	return n, nil
}

// Normalize makes a choice of messages one range: from its smallest
// sequence number to its largest. Filled reports that messages between
// were not chosen and are now in.
func Normalize(seqs []int) (from, to int, filled bool) {
	if len(seqs) == 0 {
		return 0, 0, false
	}
	from, to = seqs[0], seqs[0]
	seen := map[int]bool{}
	for _, s := range seqs {
		from, to = min(from, s), max(to, s)
		seen[s] = true
	}
	return from, to, len(seen) != to-from+1
}

// argsLen is about how much of a tool call's input its summary shows.
const argsLen = 300

func toolText(m model.Message, thinking bool) string {
	t := m.Tool
	var b strings.Builder
	fmt.Fprintf(&b, "工具：%s\n参数：%s\n", t.Name, Args(t.Input, argsLen))
	for _, c := range m.Children {
		role := "子代理回复"
		if c.Kind == model.ToolCall {
			role = "子代理调用"
		}
		fmt.Fprintf(&b, "\n%s：%s\n", role, strings.ReplaceAll(body(c, thinking), "\n", "\n  "))
	}
	switch {
	case !t.Done:
		b.WriteString("结果：（没有结果）")
	case t.IsError:
		b.WriteString("结果（出错）：\n" + strings.TrimRight(t.Output, "\n"))
	default:
		b.WriteString("结果：\n" + strings.TrimRight(t.Output, "\n"))
	}
	if t.Truncated {
		b.WriteString("\n……（输出超过 1 MB，之后的部分没有保存）")
	}
	return b.String()
}

// Args summarizes a tool call's input on one line: its JSON, cut to
// about n characters.
func Args(input []byte, n int) string {
	s := strings.Join(strings.Fields(string(input)), " ")
	if s == "" {
		return "{}"
	}
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "……"
	}
	return s
}
