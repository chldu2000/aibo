package codex

// The words aibo says to Codex, or writes into the transcript in its
// place, which are not the user's interface and so not in locales
// (docs/agents/conventions.md).

const (
	// filesHeading starts the list of the files a message mentions;
	// dirMark follows a directory's.
	filesHeading = "提到的文件（需要时请自己读取）："
	dirMark      = "（目录）"
	// commandDeclined and editDeclined stand for the output of a command
	// or a change the user declined.
	commandDeclined = "（命令被拒绝执行）"
	editDeclined    = "（修改被拒绝）"
)

// denyNote goes before the next message after the user declined a
// request saying why: Codex's decline carries no reason.
func denyNote(said string) string {
	return "（关于我刚才拒绝的操作，说明一下：" + said + "）\n\n"
}
