<#
.SYNOPSIS
Starts the career-ops browser dashboard (node src/server/start.mjs) from the repository root.

.DESCRIPTION
Checks the prerequisites first and fails with one clear message per problem: Node.js 24+, the
repository layout, installed dependencies, a reachable database and a free loopback port. Then
starts the server in this console, waits until the port accepts connections, prints the address
and stays in the foreground. Ctrl+C stops the server gracefully. Background work (evaluations,
drafts, scans) runs in detached workers that keep going after the server stops.

The server only ever listens on 127.0.0.1. No secret is read, printed or passed on a command line.

.PARAMETER Port
Loopback port. Defaults to the PORT environment variable, then 4310.

.PARAMETER NoOpen
Do not open the browser.

.PARAMETER Check
Run the prerequisite checks and exit without starting anything.

.PARAMETER Stop
Stop the dashboard server this script started (found through its private pid record).

.PARAMETER Up
Start the always-on background service (hidden supervisor that waits for the database and
restarts the server if it dies). Does nothing if the recorded server is already running.

.PARAMETER Restart
Stop whichever server is recorded (foreground or service), then -Up.

.PARAMETER Status
Print whether the server runs (pid, port, uptime, URL) and whether the logon entry is installed.

.PARAMETER Install
Register a Task Scheduler entry that starts the service at your Windows logon (current user, no
administrator rights), then start it now if it is not running.

.PARAMETER Uninstall
Remove the logon entry. A running server is left alone.

.NOTES
Exit codes: 0 ok, 10 Node, 11 repository layout, 12 dependencies, 13 database, 14 port in use,
15 already running, 16 server exited before it was ready, 17 invalid port, 18 (retired: -Stop is
idempotent), 19 logon entry could not be registered.
#>
[CmdletBinding()]
param(
  [int]$Port = 0,
  [switch]$NoOpen,
  [switch]$Check,
  [switch]$Stop,
  [switch]$Up,
  [switch]$Restart,
  [switch]$Status,
  [switch]$Install,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).ProviderPath
$PidFile = Join-Path $Root 'logs\dashboard\web-server.json'
$Entry = Join-Path $Root 'src\server\start.mjs'

function Fail([int]$Code, [string]$Message) {
  [Console]::Error.WriteLine("Dashboard not started: $Message")
  exit $Code
}

function Read-PidRecord {
  if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
  try { return Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json } catch { return $null }
}

$TaskName = 'career-ops dashboard'
$LogFile = Join-Path $Root 'logs\dashboard\server.log'
$Supervisor = Join-Path $Root 'src\helpers\dashboard-supervisor.mjs'

# A process, but only when it is still the one that was recorded (a recycled pid has a different
# start time).
function Test-Identity($ProcessId, $StartedUtc) {
  if (-not $ProcessId -or -not $StartedUtc) { return $null }
  $proc = Get-Process -Id ([int]$ProcessId) -ErrorAction SilentlyContinue
  if (-not $proc) { return $null }
  try {
    $recorded = [DateTime]::Parse($StartedUtc).ToUniversalTime()
    if ([Math]::Abs(($proc.StartTime.ToUniversalTime() - $recorded).TotalSeconds) -gt 5) { return $null }
  } catch { return $null }
  return $proc
}

# What the pid record says is running. Mode is 'service' (a supervisor owns the server),
# 'foreground' (started by this script in a console) or 'orphan' (server alive, supervisor gone).
function Get-DashboardState {
  $record = Read-PidRecord
  $state = [pscustomobject]@{ Record = $record; Supervisor = $null; Server = $null; Running = $false; Mode = $null }
  if (-not $record) { return $state }
  if ($record.supervisorPid) { $state.Supervisor = Test-Identity $record.supervisorPid $record.supervisorStartedUtc }
  if ($record.pid) { $state.Server = Test-Identity $record.pid $record.startedUtc }
  if ($state.Supervisor) { $state.Mode = 'service'; $state.Running = $true }
  elseif ($state.Server) { $state.Mode = $(if ($record.supervisorPid) { 'orphan' } else { 'foreground' }); $state.Running = $true }
  return $state
}

function Test-PortAnswers([int]$TestPort) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try { $client.Connect([System.Net.IPAddress]::Loopback, $TestPort); return $true } catch { return $false } finally { $client.Close() }
}

# Stops whichever server is recorded. The supervisor goes first so it cannot restart the server.
# Only these processes are ended, never their process trees: detached workers keep running.
# Returns $true when something was stopped.
function Stop-Dashboard {
  $state = Get-DashboardState
  if (-not $state.Running) {
    if (Test-Path -LiteralPath $PidFile) { Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue }
    return $false
  }
  if ($state.Mode -eq 'foreground') {
    # The foreground wrapper treats a vanished record as a clean stop.
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $state.Server.Id -Force
    $null = $state.Server.WaitForExit(10000)
    Write-Host "Dashboard server (pid $($state.Server.Id)) stopped. Background workers were left running."
    return $true
  }
  if ($state.Supervisor) {
    Stop-Process -Id $state.Supervisor.Id -Force -ErrorAction SilentlyContinue
    $null = $state.Supervisor.WaitForExit(10000)
  }
  # The supervisor may have replaced the server just before it died, so read the record again.
  $latest = Read-PidRecord
  $server = if ($latest) { Test-Identity $latest.pid $latest.startedUtc } else { $null }
  if (-not $server) { $server = $state.Server }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  if ($server) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    $null = $server.WaitForExit(10000)
    Write-Host "Dashboard stopped (server pid $($server.Id)). Background workers were left running."
  } else {
    Write-Host 'Dashboard service stopped (the server was between restarts).'
  }
  return $true
}

function Get-LogonEntry {
  try { return Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop } catch { return $null }
}

function Write-LogTail {
  if (Test-Path -LiteralPath $LogFile) {
    [Console]::Error.WriteLine('Last lines of logs\dashboard\server.log:')
    Get-Content -LiteralPath $LogFile -Tail 12 | ForEach-Object { [Console]::Error.WriteLine("  $_") }
  }
}

if ($Port -eq 0) {
  $Port = if ($env:PORT -and $env:PORT -match '^\d{1,5}$') { [int]$env:PORT } else { 4310 }
}
if ($Port -lt 1 -or $Port -gt 65535) { Fail 17 "port must be an integer from 1 to 65535 (got $Port)." }

if ($Stop) {
  # Idempotent: stopping what is not running is a success (exit 18 is retired).
  if (-not (Stop-Dashboard)) { Write-Host 'No dashboard server started by this script is running; nothing to stop.' }
  exit 0
}

if ($Uninstall) {
  if (Get-LogonEntry) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host 'Logon entry removed. A running dashboard was left alone.'
  } else {
    Write-Host 'The logon entry is not installed.'
  }
  exit 0
}

if ($Status) {
  $state = Get-DashboardState
  $logon = if (Get-LogonEntry) { 'installed' } else { 'not installed' }
  if ($state.Running) {
    $record = $state.Record
    $detail = ''
    if ($state.Server) {
      $uptime = [DateTime]::UtcNow - $state.Server.StartTime.ToUniversalTime()
      $detail = ", server pid $($state.Server.Id), up $([int]$uptime.TotalHours)h $($uptime.Minutes)m"
    } else {
      $detail = ", server not running (supervisor state: $($record.state))"
    }
    $listening = if ($record.port) { [int]$record.port } else { $Port }
    Write-Host "Dashboard: running ($($state.Mode)$detail), port $listening, http://localhost:$listening/, logon entry $logon."
  } else {
    $why = ''
    if ($state.Record -and $state.Record.state -eq 'gave-up') { $why = ' The service gave up after repeated failures; see logs\dashboard\server.log.' }
    Write-Host "Dashboard: not running, logon entry $logon.$why"
  }
  exit 0
}

# 1. Node.js 24+
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 10 'Node.js was not found on PATH. Install Node.js 24 or newer from https://nodejs.org and open a new terminal.' }
$nodeVersion = (& $node.Source --version).Trim()
if ($nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) {
  Fail 10 "Node.js 24 or newer is required (found $nodeVersion)."
}

# 2. Repository layout and dependencies
if (-not (Test-Path -LiteralPath $Entry) -or -not (Test-Path -LiteralPath (Join-Path $Root 'package.json'))) {
  Fail 11 "this script must live in src\helpers of the career-ops repository (looked for src\server\start.mjs under $Root)."
}
foreach ($pkg in 'vite', 'fastify', 'pg') {
  if (-not (Test-Path -LiteralPath (Join-Path $Root "node_modules\$pkg\package.json"))) {
    Fail 12 "dependency '$pkg' is missing. Run npm install from $Root, then try again."
  }
}

# npm's launcher is needed for the frontend build. start.mjs finds it through npm_execpath, which
# only npm itself sets, so locate the copy that ships with this Node.js and pass it along.
$npmCli = $env:npm_execpath
if (-not $npmCli -or -not (Test-Path -LiteralPath $npmCli)) {
  $npmCli = Join-Path (Split-Path $node.Source) 'node_modules\npm\bin\npm-cli.js'
}
if (-not (Test-Path -LiteralPath $npmCli)) {
  Fail 12 'npm was not found next to Node.js. Reinstall Node.js 24 or newer (it includes npm).'
}

# Always-on service: -Up, -Restart, -Install. The database is not required here: the supervisor
# waits for it (up to five minutes) and then starts the server anyway.
function Start-Background {
  $state = Get-DashboardState
  if ($state.Running) {
    Write-Host "Dashboard is already running ($($state.Mode), port $($state.Record.port)). Use -Restart to replace it."
    return
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $PidFile) | Out-Null
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  if (Test-PortAnswers $Port) {
    $owner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    $who = ''
    if ($owner) {
      $holder = Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue
      if ($holder) { $who = " It is held by process $($holder.ProcessName) (pid $($holder.Id)); nothing was stopped." }
    }
    Fail 14 "port $Port on 127.0.0.1 is already in use.$who Choose another with -Port, or stop the other program."
  }
  $env:npm_execpath = $npmCli
  $env:PORT = [string]$Port
  $argumentList = @(('"{0}"' -f $Supervisor), '--port', [string]$Port)
  $proc = Start-Process -FilePath $node.Source -ArgumentList $argumentList -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  $deadline = [DateTime]::UtcNow.AddMinutes(3)
  while ([DateTime]::UtcNow -lt $deadline) {
    $record = Read-PidRecord
    if ($record -and $record.supervisorPid -eq $proc.Id) {
      if ($record.state -eq 'gave-up') {
        Write-LogTail
        Fail 16 'the server kept failing and the service gave up. Fix the cause shown above and run npm run web:up.'
      }
      if ($record.state -eq 'waiting-database') {
        Write-Host 'Dashboard service started and is waiting for the database (up to 5 minutes); the server starts as soon as it is reachable, or then anyway.'
        return
      }
      if ($record.pid -and (Test-PortAnswers $Port)) {
        Write-Host "Dashboard ready at http://localhost:$Port/  (server pid $($record.pid), supervisor pid $($proc.Id))."
        return
      }
    }
    if ($proc.HasExited) {
      if ((Get-DashboardState).Running) { Write-Host 'Another dashboard service was already running; nothing more to do.'; return }
      Write-LogTail
      Fail 16 "the supervisor exited (code $($proc.ExitCode)) before the server was ready."
    }
    Start-Sleep -Milliseconds 500
  }
  Write-LogTail
  Fail 16 'the server did not open its port within 3 minutes.'
}

if ($Restart) {
  $null = Stop-Dashboard
  Start-Background
  exit 0
}

if ($Up) {
  Start-Background
  exit 0
}

if ($Install) {
  $account = "$env:USERDOMAIN\$env:USERNAME"
  try {
    # conhost --headless keeps the logon start free of any console window. The action holds only
    # paths and the port; no secret is passed on a command line or stored in the task.
    $action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\conhost.exe') `
      -Argument ('--headless "{0}" "{1}" --port {2}' -f $node.Source, $Supervisor, $Port) -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
    $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
    $null = Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
      -Settings $settings -Description 'Starts the career-ops browser dashboard service at logon (see src/helpers/Start-Dashboard.ps1).' -Force
  } catch {
    [Console]::Error.WriteLine("Could not register the logon entry: $($_.Exception.Message)")
    exit 19
  }
  Write-Host "Logon entry '$TaskName' installed for $account."
  Start-Background
  exit 0
}

# 3. Database reachable. The probe prints only OK or a fixed code, never connection details.
$probe = @'
const { pathToFileURL } = await import('node:url');
const { join } = await import('node:path');
const base = process.argv[2];
try {
  const { query, close } = await import(pathToFileURL(join(base, 'src', 'lib', '_database.mjs')).href);
  try { await query('SELECT 1'); console.log('OK'); } finally { await close?.().catch(() => {}); }
} catch (error) {
  const text = String(error?.message ?? '');
  if (text.startsWith('Database not configured')) console.log('CONFIG');
  else console.log('FAIL ' + (error?.code ?? error?.name ?? 'ERROR'));
}
'@
$probeResult = ($probe | & $node.Source --input-type=module - $Root 2>$null | Select-Object -Last 1)
switch -Regex ("$probeResult") {
  '^OK$' { }
  '^CONFIG$' { Fail 13 'the database is not configured. Create .env with POSTGRES_PASSWORD (node src/helpers/db-infra.mjs init) or set DATABASE_URL; see infra/README.md.' }
  '^FAIL (ECONNREFUSED|ETIMEDOUT|ENOTFOUND|57P03|08006)' { Fail 13 'the database is not reachable. Start it with npm run db:up and try again.' }
  '^FAIL 28' { Fail 13 'the database rejected the credentials in .env. Check POSTGRES_PASSWORD against the running container.' }
  default { Fail 13 "the database check failed ($probeResult). Run npm run db:up, then see infra/README.md." }
}

# 4. Already running from this script, then port free
$existing = Get-DashboardState
if ($existing.Running) { Fail 15 "a dashboard server started by this script is already running ($($existing.Mode)). Use -Stop first." }

$listener = $null
try {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  $listener.Start()
} catch {
  $owner = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  $who = ''
  if ($owner) {
    $p = Get-Process -Id $owner.OwningProcess -ErrorAction SilentlyContinue
    if ($p) { $who = " It is held by process $($p.ProcessName) (pid $($p.Id)); nothing was stopped." }
  }
  Fail 14 "port $Port on 127.0.0.1 is already in use.$who Choose another with -Port, or stop the other program."
} finally {
  if ($listener) { $listener.Stop() }
}

if ($Check) {
  Write-Host "Prerequisites ok: Node $nodeVersion, dependencies installed, database reachable, port $Port free."
  exit 0
}

# 5. Start from the repository root and wait for readiness
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $node.Source
$psi.Arguments = '"' + $Entry + '"' + $(if ($NoOpen) { ' --no-open' } else { '' })
$psi.WorkingDirectory = $Root
$psi.UseShellExecute = $false
$psi.EnvironmentVariables['PORT'] = [string]$Port
$psi.EnvironmentVariables['npm_execpath'] = $npmCli
$child = [System.Diagnostics.Process]::Start($psi)
New-Item -ItemType Directory -Force -Path (Split-Path $PidFile) | Out-Null
@{ pid = $child.Id; startedUtc = $child.StartTime.ToUniversalTime().ToString('o'); port = $Port } |
  ConvertTo-Json | Set-Content -LiteralPath $PidFile -Encoding ascii

$exitCode = 0
try {
  $ready = $false
  $deadline = [DateTime]::UtcNow.AddMinutes(3)
  while (-not $child.HasExited -and [DateTime]::UtcNow -lt $deadline) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $client.Connect([System.Net.IPAddress]::Loopback, $Port)
      $ready = $true
    } catch { } finally { $client.Close() }
    if ($ready) { break }
    Start-Sleep -Milliseconds 400
  }
  if ($ready) {
    Write-Host "Dashboard ready at http://127.0.0.1:$Port/  (pid $($child.Id)). Press Ctrl+C to stop."
    while (-not $child.HasExited) { Start-Sleep -Milliseconds 300 }
  } elseif ($child.HasExited) {
    [Console]::Error.WriteLine("Dashboard not started: the server exited (code $($child.ExitCode)) before it was ready. Its message is above.")
    $exitCode = 16
  } else {
    [Console]::Error.WriteLine('Dashboard not started: the server did not open its port within 3 minutes.')
    $exitCode = 16
  }
} finally {
  # Ctrl+C reaches the server too and it closes itself; give it time, then end only its process.
  if (-not $child.HasExited) {
    if (-not $child.WaitForExit(10000)) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue }
  }
  # -Stop from another window removes the pid record before the server ends; that is a clean stop.
  $stoppedByStop = -not (Test-Path -LiteralPath $PidFile)
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  if ($exitCode -eq 0 -and -not $stoppedByStop -and $child.HasExited -and $child.ExitCode -ne 0) { $exitCode = $child.ExitCode }
}
exit $exitCode
