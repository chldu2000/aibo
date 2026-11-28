package agent

import (
	"fmt"
	"strings"
)

// FileChangeKind is what a tool call does to a file.
type FileChangeKind string

const (
	FileModified FileChangeKind = "modified"
	FileAdded    FileChangeKind = "added"
	FileDeleted  FileChangeKind = "deleted"
	// FileMoved is a file moved, MovedTo its new path, changed or not.
	FileMoved FileChangeKind = "moved"
)

// FileChange is a change a tool call makes to a file, as the adapter
// learned it from the Agent: the workbench does not read tools' inputs
// for it.
type FileChange struct {
	Path    string
	Kind    FileChangeKind
	MovedTo string `json:",omitempty"`
	// Patch is the change as a unified diff of the one file, under its
	// "---" and "+++" lines: hunks with the context the Agent gave, or a
	// file's whole text, added or deleted. Empty when the Agent told none,
	// as for a file moved unchanged.
	Patch string `json:",omitempty"`
}

// PatchHunks is the patch of the file at path of hunks, each its "@@"
// line and its lines, as Agents give them.
func PatchHunks(path string, hunks ...string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "--- a/%s\n+++ b/%s\n", path, path)
	for _, h := range hunks {
		b.WriteString(strings.TrimSuffix(h, "\n"))
		b.WriteString("\n")
	}
	return b.String()
}

// PatchAdded is the patch of a file added at path with text.
func PatchAdded(path, text string) string {
	lines := patchLines(text, "+")
	return fmt.Sprintf("--- /dev/null\n+++ b/%s\n@@ -0,0 +1,%d @@\n%s", path, countLines(text), lines)
}

// PatchDeleted is the patch of the file at path deleted, which held text.
func PatchDeleted(path, text string) string {
	lines := patchLines(text, "-")
	return fmt.Sprintf("--- a/%s\n+++ /dev/null\n@@ -1,%d +0,0 @@\n%s", path, countLines(text), lines)
}

// PatchStats counts the lines a patch adds and deletes, in its hunks: a
// line deleted that read "-- x" is no header.
func PatchStats(patch string) (added, deleted int) {
	hunks := false
	for l := range strings.SplitSeq(patch, "\n") {
		switch {
		case strings.HasPrefix(l, "@@"):
			hunks = true
		case !hunks:
		case strings.HasPrefix(l, "+"):
			added++
		case strings.HasPrefix(l, "-"):
			deleted++
		}
	}
	return added, deleted
}

func countLines(text string) int {
	if text == "" {
		return 0
	}
	return strings.Count(strings.TrimSuffix(text, "\n"), "\n") + 1
}

// patchLines are text's lines, each after mark, marked when the last
// does not end in a newline.
func patchLines(text, mark string) string {
	if text == "" {
		return ""
	}
	var b strings.Builder
	for l := range strings.SplitSeq(strings.TrimSuffix(text, "\n"), "\n") {
		b.WriteString(mark + l + "\n")
	}
	if !strings.HasSuffix(text, "\n") {
		b.WriteString("\\ No newline at end of file\n")
	}
	return b.String()
}
