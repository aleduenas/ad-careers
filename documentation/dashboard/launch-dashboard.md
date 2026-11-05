# dashboard/launch-dashboard.ps1

**Authority:** [dashboard/launch-dashboard.ps1](../../dashboard/launch-dashboard.ps1).

Launches the installed Windows dashboard against the correct repository.

## Inputs

Resolves `dashboard.exe` beside the script and the repository as its parent directory; requires a previously built executable.

## Outputs and behavior

Sets UTF-8 console output and invokes the executable with `--path`. Prints build instructions and exits 1 when the binary is absent.

## Dependencies and callers

Uses PowerShell and `chcp`; does not build the binary. Run `dashboard/launch-dashboard.ps1` from the repository root or use an existing shortcut.

