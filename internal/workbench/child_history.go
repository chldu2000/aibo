package workbench

import (
	"context"
	"github.com/chldu2000/aibo/internal/agent"
	"slices"
)

// ChildHistory reads only a child named by a recorded delegation that
// belongs to one of this session's native threads.
func (w *Workbench) ChildHistory(ctx context.Context, id, activity, cursor string) (agent.ChildPage, error) {
	sess, ok := w.Session(id)
	if !ok {
		return agent.ChildPage{}, ErrNoSuchSession
	}
	reader, ok := w.agent(sess.Agent).(agent.ChildHistoryReader)
	if !ok {
		return agent.ChildPage{}, agent.ErrChildHistory
	}
	msgs, err := w.Messages(id)
	if err != nil {
		return agent.ChildPage{}, err
	}
	for _, a := range Activities(msgs, Delegations) {
		if a.ID != activity {
			continue
		}
		t := a.Message.Tool
		if t.NativeThread != "" && t.ChildThread != "" && slices.Contains(sess.NativeIDs, t.NativeThread) {
			return reader.ReadChildPage(ctx, t.NativeThread, t.ChildThread, cursor, 8)
		}
	}
	return agent.ChildPage{}, agent.ErrChildHistory
}
