package claude

// The words aibo says to Claude Code, which are not the user's interface
// and so not in locales (docs/agents/conventions.md).

// filesHeading starts the list of the files a message mentions.
const filesHeading = "提到的文件："

// denyNote is what Claude Code is told when the user denies a request,
// with what the user said, if anything.
func denyNote(said string) string {
	if said == "" {
		return "用户拒绝了这个操作。"
	}
	return "用户拒绝了这个操作：" + said
}
