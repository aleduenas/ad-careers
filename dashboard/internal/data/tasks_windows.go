//go:build windows

package data

import "os"

// processAlive reports whether a task's owner is still running. On Windows,
// FindProcess opens the process and fails when it no longer exists.
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	process.Release()
	return true
}
