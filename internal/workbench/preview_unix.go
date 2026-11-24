//go:build unix

package workbench

import "syscall"

// Avoid blocking if a file is replaced by a pipe between lstat and open.
const previewNonblock = syscall.O_NONBLOCK
