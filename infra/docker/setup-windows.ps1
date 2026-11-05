param([switch]$Enable)
$ErrorActionPreference = 'Stop'
$logRoot = Join-Path $PSScriptRoot '..\..\logs\infra'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Start-Transcript -Path (Join-Path $logRoot 'setup-windows.log') -Append
try {
$dockerPath = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'
if (-not (Test-Path $dockerPath)) {
  $dockerPath = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
}
Write-Output 'Checking WSL and Docker Desktop Linux backend'
wsl.exe --status
$wslStatus = $LASTEXITCODE
if ($Enable) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { throw 'Run this script with -Enable from an administrator PowerShell to enable WSL.' }
  $restartRequired = $false
  foreach ($feature in @('VirtualMachinePlatform','Microsoft-Windows-Subsystem-Linux')) {
    $state = Get-WindowsOptionalFeature -Online -FeatureName $feature
    Write-Output "$feature : $($state.State)"
    if ($state.State -eq 'EnablePending') { $restartRequired = $true; continue }
    if ($state.State -ne 'Enabled') {
      $result = Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart
      if ($result.RestartNeeded) { $restartRequired = $true }
    }
  }
  if ($restartRequired) {
    Write-Output 'RESTART REQUIRED: Save your work and restart Windows, then rerun infra/docker/setup-windows.ps1 -Enable. No automatic restart will be performed.'
    exit 3010
  }
  # Repair package registration when wsl.exe exists but its MSI class is absent.
  if ($wslStatus -ne 0) {
    winget.exe install --id Microsoft.WSL --exact --accept-source-agreements --accept-package-agreements --silent
  }
  $installOutput = wsl.exe --install --no-distribution 2>&1
  $installExit = $LASTEXITCODE
  $installText = ($installOutput -join "`n") -replace "`0", ''
  Write-Output $installText
  if ($installExit -eq 3010 -or $installText -match 'reboot|restart') {
    Write-Output 'RESTART REQUIRED: Save your work and restart Windows, then launch Docker Desktop and rerun this script. No automatic restart will be performed.'
    exit 3010
  }
  if ($installExit -ne 0) { throw 'WSL installation failed. Check firmware virtualization and Windows optional features.' }
  Write-Output 'If Windows requests a restart, restart and rerun this script.'
}
if (Test-Path $dockerPath) {
  & $dockerPath version
  & $dockerPath info --format '{{.OSType}}'
} else {
  Write-Output 'Docker Desktop executable not found. Finish its installation and enable the WSL 2 Linux backend.'
}
} finally { Stop-Transcript }
