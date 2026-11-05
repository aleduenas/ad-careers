# infra/docker/setup-windows.ps1

**Authority:** [infra/docker/setup-windows.ps1](../../../infra/docker/setup-windows.ps1).

Checks Windows WSL and Docker Desktop prerequisites; optionally enables WSL.

## Inputs

Run `powershell -File infra/docker/setup-windows.ps1` for diagnostics. `-Enable` requires administrator PowerShell and may enable Windows features/install WSL.

## Outputs and behavior

Prints WSL/Docker status, writes a transcript, and exits 3010 when restart is required; never automatically restarts Windows. Its transcript is `logs/infra/setup-windows.log` relative to the repository root.

## Dependencies and callers

Uses Windows optional-feature cmdlets, `wsl.exe`, `winget.exe` and Docker Desktop. This is host setup, not database migration.

