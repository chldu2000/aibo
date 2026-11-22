package agent

import (
	"encoding/json"
	"log/slog"
	"slices"
	"strings"
)

// LogSetter is an Agent that writes to the diagnostic log: its
// processes' start, exit and stderr, and the messages it does not know.
// It never writes what the user or the model said, references, tokens or
// credentials (Shape).
type LogSetter interface {
	SetLog(log *slog.Logger)
}

// Shape is what the diagnostic log keeps of a message an adapter does not
// know: its fields' names, sorted, without their values; "" for what is
// not a JSON object.
func Shape(raw []byte) string {
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return strings.Join(keys, ",")
}

// Discard is a logger that writes nothing, for an Agent given none.
var Discard = slog.New(slog.DiscardHandler)

// LineLog is a writer of a process's stderr that writes each line to the
// log, cut to a few hundred characters: what the Agent says went wrong.
type LineLog struct {
	Log  *slog.Logger
	Attr []any
	buf  []byte
}

// lineMax is the most of a stderr line logged.
const lineMax = 500

func (w *LineLog) Write(p []byte) (int, error) {
	w.buf = append(w.buf, p...)
	for {
		i := strings.IndexByte(string(w.buf), '\n')
		if i < 0 {
			break
		}
		w.line(string(w.buf[:i]))
		w.buf = w.buf[i+1:]
	}
	if len(w.buf) > 4*lineMax {
		w.line(string(w.buf))
		w.buf = nil
	}
	return len(p), nil
}

func (w *LineLog) line(s string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return
	}
	if r := []rune(s); len(r) > lineMax {
		s = string(r[:lineMax]) + "…"
	}
	w.Log.Warn("stderr", append(append([]any(nil), w.Attr...), "line", s)...)
}
