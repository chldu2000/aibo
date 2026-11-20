// Package fake is a scripted Agent: tests and the demo build drive the
// workbench with it instead of a real Agent. A Responder writes each
// turn's events; everything else (native session IDs, turn endings,
// interrupts) behaves as an adapter must.
package fake

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Kind is the fake Agent's kind.
const Kind agent.Kind = "fake"

// Responder writes the events of one turn through emit, and returns when
// the turn is over. opts are the session's, with the workbench MCP server
// it can call (CallTool). ctx is canceled when the turn is interrupted or
// the session closed; the fake then ends the turn as interrupted.
type Responder func(ctx context.Context, opts agent.StartOptions, turn agent.Turn, emit func(agent.Event))

// Agent is the scripted Agent.
type Agent struct {
	respond   Responder
	decisions chan Decision
	levels    chan agent.ApprovalLevel

	mu          sync.Mutex
	resumeFails string
	starts      []agent.StartOptions
	nextID      int
}

// New returns a fake Agent answering every turn with respond.
func New(respond Responder) *Agent {
	return &Agent{respond: respond, decisions: make(chan Decision, 64), levels: make(chan agent.ApprovalLevel, 64)}
}

// Decision is an answer to an approval request a Responder emitted.
type Decision struct {
	ID, OptionID, Note string
}

// Decisions delivers the answers to approval requests, for Responders to
// wait on.
func (a *Agent) Decisions() <-chan Decision { return a.decisions }

// Levels delivers the approval levels set on running sessions.
func (a *Agent) Levels() <-chan agent.ApprovalLevel { return a.levels }

func (a *Agent) Kind() agent.Kind { return Kind }
func (a *Agent) Name() string     { return "假 Agent" }

// ToolName is the tool's own name: the fake calls tools by it.
func (a *Agent) ToolName(tool string) string { return tool }

// FailResumes makes every Start that resumes fail with ErrResumeFailed
// and why, as an Agent that lost its native sessions; "" stops it.
func (a *Agent) FailResumes(why string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.resumeFails = why
}

// Starts returns the options of every Start so far, in order.
func (a *Agent) Starts() []agent.StartOptions {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]agent.StartOptions(nil), a.starts...)
}

func (a *Agent) Start(ctx context.Context, opts agent.StartOptions) (agent.Session, error) {
	a.mu.Lock()
	a.starts = append(a.starts, opts)
	if opts.ResumeID != "" && a.resumeFails != "" {
		why := a.resumeFails
		a.mu.Unlock()
		return nil, fmt.Errorf("%w：%s", agent.ErrResumeFailed, why)
	}
	id := opts.ResumeID
	if id == "" {
		a.nextID++
		id = fmt.Sprintf("fake-native-%d", a.nextID)
	}
	a.mu.Unlock()
	s := &session{respond: a.respond, opts: opts, decisions: a.decisions, levels: a.levels, events: make(chan agent.Event, 256)}
	s.events <- agent.NativeSessionStarted{ID: id}
	return s, nil
}

type session struct {
	respond   Responder
	opts      agent.StartOptions
	decisions chan Decision
	levels    chan agent.ApprovalLevel
	events    chan agent.Event

	mu     sync.Mutex
	cancel context.CancelFunc // of the running turn
	closed bool
	turns  sync.WaitGroup
}

func (s *session) Events() <-chan agent.Event { return s.events }

func (s *session) Send(_ context.Context, turn agent.Turn) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("fake: session closed")
	}
	if s.cancel != nil {
		return errors.New("fake: a turn is already running")
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.turns.Add(1)
	go func() {
		defer s.turns.Done()
		if turn.Text == CompactTurn {
			s.events <- agent.Compacted{Trigger: "manual", PreTokens: 1000, PostTokens: 100}
		} else {
			s.respond(ctx, s.opts, turn, func(e agent.Event) { s.events <- e })
		}
		s.mu.Lock()
		s.cancel = nil
		s.mu.Unlock()
		s.events <- agent.TurnEnded{Interrupted: ctx.Err() != nil}
		cancel()
	}()
	return nil
}

func (s *session) Interrupt(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
	return nil
}

func (s *session) RespondApproval(_ context.Context, id, optionID, note string) error {
	s.decisions <- Decision{ID: id, OptionID: optionID, Note: note}
	return nil
}

// Compact runs a turn that compacts: it reports Compacted, manual.
func (s *session) Compact(ctx context.Context) error {
	return s.Send(ctx, agent.Turn{Text: CompactTurn})
}

// CompactTurn is the text of the turns Compact runs, for Responders to
// tell them apart; the default answer reports Compacted.
const CompactTurn = "\x00compact"

// SetLevel records the level, which Levels reports.
func (s *session) SetLevel(_ context.Context, level agent.ApprovalLevel) error {
	s.levels <- level
	return nil
}

func (s *session) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	if s.cancel != nil {
		s.cancel()
	}
	s.mu.Unlock()
	s.turns.Wait()
	close(s.events)
	return nil
}

// Stream emits text as reply id in chunks of a few characters, one every
// delay, then ends the reply. It stops early when ctx is canceled.
func Stream(ctx context.Context, emit func(agent.Event), id, text string, delay time.Duration) {
	for rest := text; rest != ""; {
		n := 0
		for i := 0; i < 4 && n < len(rest); i++ {
			_, size := utf8.DecodeRuneInString(rest[n:])
			n += size
		}
		emit(agent.ReplyDelta{ReplyID: id, Text: rest[:n]})
		rest = rest[n:]
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
	emit(agent.ReplyDone{ReplyID: id})
}

var refBlock = regexp.MustCompile(`<aibo-reference id="([^"]+)">`)

// Demo answers every turn with a canned Markdown reply, streamed at the
// pace of a model. Given references, it first reads them through the
// workbench MCP server, as a real Agent would. The demo build uses it
// while no real Agent is wired.
func Demo(ctx context.Context, opts agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
	text := refBlock.ReplaceAllString(turn.Text, "")
	if i := strings.LastIndex(text, "</aibo-reference>"); i >= 0 {
		text = text[i+len("</aibo-reference>"):]
	}
	var b strings.Builder
	for _, m := range refBlock.FindAllStringSubmatch(turn.Text, -1) {
		out, isErr, err := CallTool(ctx, opts.MCP, "read_reference", map[string]any{"ref_id": m[1]})
		switch {
		case err != nil:
			fmt.Fprintf(&b, "读取引用 `%s` 失败：%v\n\n", m[1], err)
		case isErr:
			fmt.Fprintf(&b, "读取引用 `%s` 时出错：%s\n\n", m[1], out)
		default:
			lines := strings.Split(strings.TrimSpace(out), "\n")
			fmt.Fprintf(&b, "我用 `read_reference` 读了引用 `%s`（%d 行），开头是：\n\n```text\n%s\n```\n\n", m[1], len(lines), strings.Join(lines[:min(len(lines), 8)], "\n"))
		}
	}
	if t := strings.TrimSpace(text); t != "" {
		b.WriteString("收到你的消息：\n\n> " + strings.ReplaceAll(t, "\n", "\n> ") + "\n\n")
	}
	b.WriteString("这是**假 Agent** 的演示回复，用来验证工作台的各层已经打通：\n\n" +
		"1. 消息写入会话存储，按序号编址；\n" +
		"2. 回复以流式 Markdown 显示，完成后改为静态渲染；\n" +
		"3. 重启 aibo 后，历史仍然在。\n")
	Stream(ctx, emit, "reply", b.String(), 25*time.Millisecond)
}

// CallTool calls a tool of the workbench MCP server, as an Agent given
// srv would, and returns its text and whether it is a tool error.
func CallTool(ctx context.Context, srv *agent.MCPServer, tool string, args map[string]any) (string, bool, error) {
	if srv == nil {
		return "", false, errors.New("没有注入工作台的 MCP server")
	}
	hc := &http.Client{Transport: bearer{token: srv.Token}}
	c := mcp.NewClient(&mcp.Implementation{Name: "aibo-fake-agent"}, nil)
	cs, err := c.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: srv.URL, HTTPClient: hc, MaxRetries: -1}, nil)
	if err != nil {
		return "", false, err
	}
	defer cs.Close()
	res, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: tool, Arguments: args})
	if err != nil {
		return "", false, err
	}
	var b strings.Builder
	for _, c := range res.Content {
		if t, ok := c.(*mcp.TextContent); ok {
			b.WriteString(t.Text)
		}
	}
	return b.String(), res.IsError, nil
}

// bearer adds a session's token to its requests.
type bearer struct{ token string }

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(r)
}
