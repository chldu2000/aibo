// Package refs renders session references as text for the receiving
// Agent: the brief that is delivered with a reference, and what the
// workbench MCP server's tools return. All of it is text for a model to
// read, in the interface's language (Chinese), with excerpts verbatim.
package refs

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/chldu2000/aibo/internal/model"
)

// Tool names of the workbench MCP server, as the server declares them.
const (
	ToolListReferences = "list_references"
	ToolReadReference  = "read_reference"
)

// Limits of a brief.
const (
	// ExcerptLen is the longest excerpt, in characters.
	ExcerptLen = 200
	// BriefLen is the longest brief block, in characters; excerpts are
	// shortened to fit it.
	BriefLen = 1500
)

// BriefInput is what a brief is made of.
type BriefInput struct {
	ID          string
	SourceTitle string
	// SourceAgent is the source Agent's display name.
	SourceAgent string
	// SourceWorkspace is set when it is not the receiving session's
	// workspace.
	SourceWorkspace string
	// Messages are the range's messages, in order.
	Messages []model.Message
	// ToolName gives a tool's name as the receiving Agent sees it.
	ToolName func(tool string) string
	// Self is set when the session receives part of itself: the brief
	// reminds the Agent of what it may have forgotten.
	Self bool
}

// Brief renders a reference's <aibo-reference> block.
func Brief(in BriefInput) string {
	for n := ExcerptLen; ; n -= 20 {
		b := brief(in, max(n, 0))
		if utf8.RuneCountInString(b) <= BriefLen || n <= 0 {
			return b
		}
	}
}

func brief(in BriefInput, excerptLen int) string {
	ms := in.Messages
	var b strings.Builder
	fmt.Fprintf(&b, "<aibo-reference id=%q>\n", in.ID)
	if in.Self {
		b.WriteString("这是本会话较早的一段内容，你的上下文中可能已不再保留其细节。当用户的请求依赖其中的内容时，\n")
		fmt.Fprintf(&b, "请先调用 %s 读取，不要凭记忆猜测细节。\n", in.ToolName(ToolReadReference))
	} else {
		b.WriteString("用户交给你一段来自另一个会话的引用（只读快照）。当用户的请求依赖其中的内容时，\n")
		fmt.Fprintf(&b, "请先调用 %s 读取，不要凭概要猜测细节。\n", in.ToolName(ToolReadReference))
		fmt.Fprintf(&b, "- 来源：「%s」· %s\n", in.SourceTitle, in.SourceAgent)
		if in.SourceWorkspace != "" {
			fmt.Fprintf(&b, "- 源工作区：%s（不是你当前的工作区；其中的相对路径都相对于它，你只能读取不能修改）\n", in.SourceWorkspace)
		}
	}
	if len(ms) > 0 {
		first, last := ms[0], ms[len(ms)-1]
		fmt.Fprintf(&b, "- 范围：%s，共 %d 条消息（%s）\n", Range(first.Seq, last.Seq), len(ms), timeSpan(first.CreatedAt, last.CreatedAt))
		for _, e := range excerpts(ms) {
			fmt.Fprintf(&b, "- %s：#%d「%s」\n", e.label, e.m.Seq, excerpt(e.m, excerptLen))
		}
	}
	fmt.Fprintf(&b, "- 可用工具：%s(ref_id=%q)、%s、%s、%s\n", in.ToolName(ToolReadReference), in.ID, in.ToolName(ToolReadMessage), in.ToolName(ToolSearchReference), in.ToolName(ToolListReferences))
	b.WriteString("</aibo-reference>")
	return b.String()
}

type labeled struct {
	label string
	m     model.Message
}

// excerpts picks the range's first user message and last Agent reply, or
// else its first and last messages.
func excerpts(ms []model.Message) []labeled {
	var user, reply *model.Message
	for i := range ms {
		if ms[i].Kind == model.UserMessage {
			user = &ms[i]
			break
		}
	}
	for i := len(ms) - 1; i >= 0; i-- {
		if ms[i].Kind == model.AgentReply {
			reply = &ms[i]
			break
		}
	}
	if user != nil && reply != nil {
		return []labeled{{"首条用户消息", *user}, {"末条 Agent 回复", *reply}}
	}
	if len(ms) == 1 {
		return []labeled{{"唯一的消息", ms[0]}}
	}
	return []labeled{{"首条消息", ms[0]}, {"末条消息", ms[len(ms)-1]}}
}

// excerpt is a message's text on one line, cut to n characters.
func excerpt(m model.Message, n int) string {
	text := strings.Join(strings.Fields(m.Text), " ")
	if r := []rune(text); len(r) > n {
		text = string(r[:n]) + "……"
	}
	if m.State == model.Interrupted {
		text += "（已中断）"
	}
	return text
}

// Range writes a range of sequence numbers, as "#7–#10" or "#7".
func Range(from, to int) string {
	if from == to {
		return fmt.Sprintf("#%d", from)
	}
	return fmt.Sprintf("#%d–#%d", from, to)
}

func timeSpan(a, b time.Time) string {
	a, b = a.Local(), b.Local()
	if a.Format("2006-01-02") == b.Format("2006-01-02") {
		return a.Format("2006-01-02 15:04") + "–" + b.Format("15:04")
	}
	return a.Format("2006-01-02 15:04") + " – " + b.Format("2006-01-02 15:04")
}

// ReadHeader starts what the read tools return: where the source's files
// are, and that they may have changed since.
func ReadHeader(r model.Reference, crossWorkspace bool) string {
	var b strings.Builder
	fmt.Fprintf(&b, "引用 %s：「%s」%s，共 %d 条消息\n", r.ID, r.SourceTitle, Range(r.From, r.To), r.Count)
	if crossWorkspace {
		fmt.Fprintf(&b, "源工作区：%s（不是你当前的工作区；其中的相对路径都相对于它，你只能读取不能修改）\n", r.SourceWorkspace)
	}
	b.WriteString("提醒：引用是创建时的快照，其中提到的文件可能已在引用之后被修改。\n")
	return b.String()
}

func roleName(k model.MessageKind, agentName string) string {
	switch k {
	case model.UserMessage:
		return "用户"
	case model.AgentReply:
		return agentName + " 回复"
	case model.ToolCall:
		return "工具调用"
	case model.Plan:
		return "计划"
	}
	return string(k)
}

// TurnText is what the receiving Agent gets for a user message: the
// blocks of the references it delivers, in order, before the user's text.
func TurnText(briefs []string, text string) string {
	if len(briefs) == 0 {
		return text
	}
	parts := append(append([]string(nil), briefs...), text)
	return strings.TrimSpace(strings.Join(parts, "\n\n"))
}
