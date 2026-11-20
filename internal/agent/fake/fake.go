// Package fake is a scripted Agent: tests and the demo build drive the
// workbench with it instead of a real Agent. A Responder writes each
// turn's events; everything else (native session IDs, turn endings,
// interrupts) behaves as an adapter must.
package fake

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/chldu2000/aibo/internal/agent"
)

// Kind is the fake Agent's kind.
const Kind agent.Kind = "fake"

// Responder writes the events of one turn through emit, and returns when
// the turn is over. ctx is canceled when the turn is interrupted or the
// session closed; the fake then ends the turn as interrupted.
type Responder func(ctx context.Context, turn agent.Turn, emit func(agent.Event))

// Agent is the scripted Agent.
type Agent struct {
	respond Responder

	mu     sync.Mutex
	starts []agent.StartOptions
	nextID int
}

// New returns a fake Agent answering every turn with respond.
func New(respond Responder) *Agent { return &Agent{respond: respond} }

func (a *Agent) Kind() agent.Kind { return Kind }
func (a *Agent) Name() string     { return "假 Agent" }

// Starts returns the options of every Start so far, in order.
func (a *Agent) Starts() []agent.StartOptions {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]agent.StartOptions(nil), a.starts...)
}

func (a *Agent) Start(ctx context.Context, opts agent.StartOptions) (agent.Session, error) {
	a.mu.Lock()
	a.starts = append(a.starts, opts)
	id := opts.ResumeID
	if id == "" {
		a.nextID++
		id = fmt.Sprintf("fake-native-%d", a.nextID)
	}
	a.mu.Unlock()
	s := &session{respond: a.respond, events: make(chan agent.Event, 256)}
	s.events <- agent.NativeSessionStarted{ID: id}
	return s, nil
}

type session struct {
	respond Responder
	events  chan agent.Event

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
		s.respond(ctx, turn, func(e agent.Event) { s.events <- e })
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

// Demo answers every turn with a canned Markdown reply, streamed at the
// pace of a model. The demo build uses it while no real Agent is wired.
func Demo(ctx context.Context, turn agent.Turn, emit func(agent.Event)) {
	quoted := "> " + strings.ReplaceAll(strings.TrimSpace(turn.Text), "\n", "\n> ")
	reply := "收到你的消息：\n\n" + quoted + "\n\n" +
		"这是**假 Agent** 的演示回复，用来验证工作台的各层已经打通：\n\n" +
		"1. 消息写入会话存储，按序号编址；\n" +
		"2. 回复以流式 Markdown 显示，完成后改为静态渲染；\n" +
		"3. 重启 aibo 后，历史仍然在。\n\n" +
		"```go\nfunc hello() string {\n\treturn \"aibo\"\n}\n```\n"
	Stream(ctx, emit, "reply", reply, 25*time.Millisecond)
}
