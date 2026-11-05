# Launches the career-ops dashboard TUI.
# Portable: resolves paths relative to this script, so it works from any clone location.
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$dashboardDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $dashboardDir
$exe = Join-Path $dashboardDir 'dashboard.exe'

if (-not (Test-Path $exe)) {
    Write-Host "dashboard.exe not found. Build it first:" -ForegroundColor Yellow
    Write-Host "  cd `"$dashboardDir`"; go build -o dashboard.exe ."
    exit 1
}

& $exe --path $repoRoot
