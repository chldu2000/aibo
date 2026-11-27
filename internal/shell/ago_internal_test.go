package shell

import (
	"testing"
	"time"
)

func TestAgo(t *testing.T) {
	now := time.Date(2026, 11, 27, 15, 0, 0, 0, time.Local)
	for _, c := range []struct {
		then time.Time
		want string
	}{
		{now.Add(-20 * time.Second), "刚刚"},
		{now.Add(-5 * time.Minute), "5 分钟"},
		{now.Add(-3 * time.Hour), "3 小时"},
		{time.Date(2026, 11, 26, 23, 0, 0, 0, time.Local), "昨天"},
		{time.Date(2026, 11, 20, 9, 0, 0, 0, time.Local), "11/20"},
		{time.Date(2025, 3, 2, 9, 0, 0, 0, time.Local), "2025/3/2"},
	} {
		if got := ago(now, c.then); got != c.want {
			t.Errorf("ago(%v) = %q, want %q", c.then, got, c.want)
		}
	}
}
