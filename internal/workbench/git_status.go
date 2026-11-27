package workbench

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"

	"github.com/chldu2000/aibo/internal/proc"
)

var (
	ErrGitMissing    = errors.New("git executable unavailable")
	ErrNotRepository = errors.New("not a git work tree")
	ErrGitRead       = errors.New("could not read repository")
	ErrGitLarge      = errors.New("git output exceeds preview limit")
)

type GitGroup uint8

const (
	GitStaged GitGroup = iota
	GitUnstaged
	GitUntracked
	GitConflict
)

type GitChange struct {
	Group                GitGroup
	Code, Path, Original string
}

type RepositoryStatus struct {
	Branch, OID string
	Changes     []GitChange
}

// gitBuffer consumes the entire pipe but retains only the bounded prefix.
type gitBuffer struct {
	bytes.Buffer
	limit    int
	overflow bool
}

func (b *gitBuffer) Write(p []byte) (int, error) {
	n := len(p)
	left := b.limit - b.Len()
	if n > left {
		p = p[:left]
		b.overflow = true
	}
	_, err := b.Buffer.Write(p)
	return n, err
}

// Hide bytes.Buffer.ReadFrom so io.Copy always respects the limit.
type gitWriter struct{ io.Writer }

func readGit(ctx context.Context, dir string, limit int, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	base := []string{"--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-C", dir}
	cmd := exec.CommandContext(ctx, "git", append(base, args...)...)
	proc.Hide(cmd)
	cmd.Env = append(cmd.Environ(), "LC_ALL=C", "GIT_TERMINAL_PROMPT=0")
	out, diag := gitBuffer{limit: limit}, gitBuffer{limit: 8192}
	cmd.Stdout, cmd.Stderr = gitWriter{&out}, gitWriter{&diag}
	if err := cmd.Run(); err != nil {
		switch {
		case ctx.Err() != nil:
			return "", ctx.Err()
		case errors.Is(err, exec.ErrNotFound):
			return "", ErrGitMissing
		case strings.Contains(diag.String(), "not a git repository"):
			return "", ErrNotRepository
		default:
			return "", fmt.Errorf("%w: %s", ErrGitRead, strings.TrimSpace(diag.String()))
		}
	}
	if out.overflow {
		return "", ErrGitLarge
	}
	return out.String(), nil
}

func (w *Workbench) RepositoryStatus(ctx context.Context, id string) (RepositoryStatus, error) {
	ws, ok := w.Workspace(id)
	if !ok {
		return RepositoryStatus{}, ErrNoSuchWorkspace
	}
	prefix, err := readGit(ctx, ws.Path, 65536, "rev-parse", "--show-prefix")
	if err != nil {
		return RepositoryStatus{}, err
	}
	prefix = strings.TrimSuffix(prefix, "\n")
	data, err := readGit(ctx, ws.Path, 8<<20, "status", "--porcelain=v2", "-z", "--branch", "--find-renames", "--untracked-files=all", "--", ".")
	if err != nil {
		return RepositoryStatus{}, err
	}
	var status RepositoryStatus
	for data != "" {
		row, rest, ok := strings.Cut(data, "\x00")
		if !ok || row == "" {
			return RepositoryStatus{}, ErrGitRead
		}
		data = rest
		switch row[0] {
		case '#':
			if v, ok := strings.CutPrefix(row, "# branch.head "); ok {
				status.Branch = v
			}
			if v, ok := strings.CutPrefix(row, "# branch.oid "); ok {
				status.OID = v
			}
		case '1', '2', 'u', '?':
			fields := map[byte]int{'1': 9, '2': 10, 'u': 11, '?': 2}
			parts := strings.SplitN(row, " ", fields[row[0]])
			if len(parts) != fields[row[0]] {
				return RepositoryStatus{}, ErrGitRead
			}
			name := parts[len(parts)-1]
			var original string
			if row[0] == '2' {
				original, data, ok = strings.Cut(data, "\x00")
				if !ok {
					return RepositoryStatus{}, ErrGitRead
				}
			}
			rel, inside := strings.CutPrefix(name, prefix)
			if !inside {
				continue
			}
			old, _ := strings.CutPrefix(original, prefix)
			add := func(group GitGroup, code, from string) {
				status.Changes = append(status.Changes, GitChange{Group: group, Code: code, Path: rel, Original: from})
			}
			switch row[0] {
			case '?':
				add(GitUntracked, "?", "")
			case 'u':
				add(GitConflict, parts[1], "")
			default:
				xy := parts[1]
				if len(xy) != 2 {
					return RepositoryStatus{}, ErrGitRead
				}
				for i, group := range []GitGroup{GitStaged, GitUnstaged} {
					if xy[i] == '.' {
						continue
					}
					from := ""
					if xy[i] == 'R' || xy[i] == 'C' {
						from = old
					}
					add(group, xy[i:i+1], from)
				}
			}
		}
	}
	return status, nil
}

func (w *Workbench) GitStatus(id string) Snapshot[RepositoryStatus] {
	return readWorkspace(w, workspaceReadKey{id, "git", ""}, func(ctx context.Context) (RepositoryStatus, error) { return w.RepositoryStatus(ctx, id) })
}
