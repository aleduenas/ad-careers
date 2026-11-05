//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

func hideWorkflowWindow(cmd *exec.Cmd) {}

// detachWorkflow puts a launched worker in its own session so it outlives the
// dashboard and never receives the terminal's signals.
func detachWorkflow(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }
