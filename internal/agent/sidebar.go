package agent

import "context"

// BackgroundReader is implemented by a live session that can query its
// own native thread. Each entry maps a reported tool item to its process.
type BackgroundReader interface {
	BackgroundThread() string
	BackgroundTerminals(context.Context) (map[string]string, error)
}
