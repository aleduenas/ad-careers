//go:build !windows

package data

import (
	"os"
	"syscall"
)

// processAlive reports whether a task's owner is still running. FindProcess
// always succeeds on Unix, so liveness is a zero signal.
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return process.Signal(syscall.Signal(0)) == nil
}
