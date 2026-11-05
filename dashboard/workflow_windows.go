//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// Windows creation flags. CREATE_NO_WINDOW gives the worker its own console
// that is never displayed, and CREATE_NEW_PROCESS_GROUP keeps console Ctrl+C
// and close events from reaching it: closing the terminal that runs the
// dashboard cannot take the worker down. DETACHED_PROCESS would also detach it,
// but a process with no console at all makes Windows allocate a fresh console
// for every child it spawns, which flashes a terminal window on the desktop
// each time a worker runs the PDF renderer, git or a CLI.
const (
	createNoWindow        = 0x08000000
	createNewProcessGroup = 0x00000200
)

func hideWorkflowWindow(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }

// detachWorkflow cuts a launched worker loose from the dashboard's console and
// process group. Tasks must outlive the dashboard that started them.
func detachWorkflow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow | createNewProcessGroup}
}
