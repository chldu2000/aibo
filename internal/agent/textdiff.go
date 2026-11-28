package agent

import (
	"fmt"
	"strings"
)

// diffContext is how many unchanged lines a hunk shows around a change,
// as git diff does.
const diffContext = 3

// diffCells bounds the table that finds the fewest lines changed between
// the parts of two texts that differ: past it, those parts are deleted
// and added whole, a diff still, not the shortest.
const diffCells = 4 << 20

// PatchTexts is the patch of the file at path changed from old to new,
// for Agents that tell the texts and no diff (ACP's): the lines changed,
// in hunks with diffContext lines around them. Empty when the texts are
// the same.
func PatchTexts(path, old, new string) string {
	a, b := splitLines(old), splitLines(new)
	ops := lineOps(a, b)
	var hunks []string
	for _, h := range hunkRanges(ops) {
		var body strings.Builder
		oldStart, newStart, oldN, newN := -1, -1, 0, 0
		for _, op := range ops[h[0]:h[1]] {
			if oldStart < 0 {
				oldStart, newStart = op.old, op.new
			}
			switch op.kind {
			case ' ':
				body.WriteString(" " + a[op.old] + "\n")
				oldN++
				newN++
			case '-':
				body.WriteString("-" + a[op.old] + "\n")
				oldN++
			case '+':
				body.WriteString("+" + b[op.new] + "\n")
				newN++
			}
		}
		hunks = append(hunks, fmt.Sprintf("@@ -%s +%s @@\n%s", hunkSpan(oldStart, oldN), hunkSpan(newStart, newN), body.String()))
	}
	if len(hunks) == 0 {
		return ""
	}
	return PatchHunks(path, hunks...)
}

// hunkSpan is a hunk's start and count, as a unified diff writes them:
// lines from 1, and an empty side after the line before it.
func hunkSpan(start, n int) string {
	if n == 0 {
		return fmt.Sprintf("%d,0", start)
	}
	return fmt.Sprintf("%d,%d", start+1, n)
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(strings.TrimSuffix(s, "\n"), "\n")
}

// lineOp is a line kept (' '), deleted ('-') or added ('+'), by its
// index in the old text and in the new: where it is, or would be.
type lineOp struct {
	kind     byte
	old, new int
}

// lineOps is how b is a from line to line: the lines both begin and end
// with kept, and between them the fewest lines deleted and added, or,
// when that part is too big to work out, all of it.
func lineOps(a, b []string) []lineOp {
	pre := 0
	for pre < len(a) && pre < len(b) && a[pre] == b[pre] {
		pre++
	}
	suf := 0
	for suf < len(a)-pre && suf < len(b)-pre && a[len(a)-1-suf] == b[len(b)-1-suf] {
		suf++
	}
	var ops []lineOp
	for i := range pre {
		ops = append(ops, lineOp{' ', i, i})
	}
	ma, mb := a[pre:len(a)-suf], b[pre:len(b)-suf]
	if (len(ma)+1)*(len(mb)+1) <= diffCells {
		ops = append(ops, shortest(ma, mb, pre)...)
	} else {
		for i := range ma {
			ops = append(ops, lineOp{'-', pre + i, pre})
		}
		for j := range mb {
			ops = append(ops, lineOp{'+', pre + len(ma), pre + j})
		}
	}
	for k := range suf {
		ops = append(ops, lineOp{' ', len(a) - suf + k, len(b) - suf + k})
	}
	return ops
}

// shortest is the fewest lines deleted and added that make b of a, by
// their longest common lines, at line base of both texts.
func shortest(a, b []string, base int) []lineOp {
	n, m := len(a), len(b)
	// lcs[i*(m+1)+j] is the longest common lines of a[i:] and b[j:].
	lcs := make([]int32, (n+1)*(m+1))
	for i := n - 1; i >= 0; i-- {
		for j := m - 1; j >= 0; j-- {
			if a[i] == b[j] {
				lcs[i*(m+1)+j] = lcs[(i+1)*(m+1)+j+1] + 1
			} else {
				lcs[i*(m+1)+j] = max(lcs[(i+1)*(m+1)+j], lcs[i*(m+1)+j+1])
			}
		}
	}
	var ops []lineOp
	i, j := 0, 0
	for i < n || j < m {
		switch {
		case i < n && j < m && a[i] == b[j]:
			ops = append(ops, lineOp{' ', base + i, base + j})
			i++
			j++
		// Deleted lines first, as git diff writes a line replaced.
		case i < n && (j == m || lcs[(i+1)*(m+1)+j] >= lcs[i*(m+1)+j+1]):
			ops = append(ops, lineOp{'-', base + i, base + j})
			i++
		default:
			ops = append(ops, lineOp{'+', base + i, base + j})
			j++
		}
	}
	return ops
}

// hunkRanges are the runs of ops each hunk shows: the changes, with
// diffContext kept lines around them, those closer than twice that in one.
func hunkRanges(ops []lineOp) [][2]int {
	var out [][2]int
	for i := 0; i < len(ops); i++ {
		if ops[i].kind == ' ' {
			continue
		}
		start := max(0, i-diffContext)
		end := i
		for end < len(ops) {
			if ops[end].kind != ' ' {
				end++
				continue
			}
			// A run of kept lines: past 2×context, the hunk ends.
			run := end
			for run < len(ops) && ops[run].kind == ' ' {
				run++
			}
			if run == len(ops) || run-end > 2*diffContext {
				end = min(end+diffContext, len(ops))
				break
			}
			end = run
		}
		if len(out) > 0 && start <= out[len(out)-1][1] {
			out[len(out)-1][1] = end
		} else {
			out = append(out, [2]int{start, end})
		}
		i = end - 1
	}
	return out
}
