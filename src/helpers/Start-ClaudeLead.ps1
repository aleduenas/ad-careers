[CmdletBinding(DefaultParameterSetName = 'Launch')]
param(
    [Parameter(ParameterSetName = 'Check', Mandatory = $true)]
    [switch]$Check,
    [Parameter(ParameterSetName = 'Launch')]
    [switch]$Resume,
    [Parameter(ParameterSetName = 'Launch')]
    [switch]$NoDiscord
)

# Launch the Claude Code development lead for the browser-dashboard migration, with the
# career-ops Discord bot attached through the official Claude Code Discord channel plugin.
# Reuses the owner ID, project channel and DPAPI-encrypted bot token that
# Start-DiscordLead.ps1 -Configure saved under config/. Nothing here starts project work.

$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    $repoRoot = 'import { root } from "../lib/root.mjs"; console.log(root);' | & node --input-type=module -
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the repository root. Check Node installation.' }
} finally {
    Pop-Location
}
$configPath = Join-Path $repoRoot 'config\discord-lead.json'
$tokenPath = Join-Path $repoRoot 'config\discord-lead-token.dpapi'
$stateDir = Join-Path $repoRoot 'logs\dev-discord-lead\claude-channel'
$accessPath = Join-Path $stateDir 'access.json'
$pluginId = 'discord@claude-plugins-official'

if (-not (Test-Path -LiteralPath $configPath) -or -not (Test-Path -LiteralPath $tokenPath)) {
    throw 'Run Start-DiscordLead.ps1 -Configure (owner + bot token) and -ProjectChannel ... -Apply first.'
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.owner_id -notmatch '^[0-9]{17,20}$') { throw 'config/discord-lead.json has no valid owner_id.' }
if ($config.project_channel_id -notmatch '^[0-9]{17,20}$') { throw 'config/discord-lead.json has no project channel. Use Start-DiscordLead.ps1 -ProjectChannel ... -Apply.' }

# Bun runs the plugin's MCP server; a terminal opened before Bun was installed lacks it on PATH.
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    $bunBin = Join-Path $env:USERPROFILE '.bun\bin'
    if (-not (Test-Path -LiteralPath (Join-Path $bunBin 'bun.exe'))) {
        throw 'Bun is missing. Install it from https://bun.sh/docs/installation.'
    }
    $env:PATH = $bunBin + [IO.Path]::PathSeparator + $env:PATH
}
$claudeCommand = Get-Command claude -ErrorAction Stop
$localSettingsPath = Join-Path $repoRoot '.claude\settings.local.json'
$pluginEnabled = $false
if (Test-Path -LiteralPath $localSettingsPath) {
    $localSettings = Get-Content -LiteralPath $localSettingsPath -Raw | ConvertFrom-Json
    $pluginEnabled = $localSettings.enabledPlugins.$pluginId -eq $true
}

# The plugin keeps its allowlist and inbox per DISCORD_STATE_DIR, so this bot never shares state
# with another project's bot. The owner is allowlisted by ID (no pairing codes), and the project
# channel is enabled without requiring an @mention so a plain channel message reaches the lead.
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $accessPath)) {
    $groups = @{}
    $groups[[string]$config.project_channel_id] = [ordered]@{
        requireMention = $false
        allowFrom = @([string]$config.owner_id)
    }
    $access = [ordered]@{
        dmPolicy = 'allowlist'
        allowFrom = @([string]$config.owner_id)
        groups = $groups
        pending = @{}
        replyToMode = 'first'
        chunkMode = 'newline'
    }
    [IO.File]::WriteAllText($accessPath, (($access | ConvertTo-Json -Depth 5) + "`n"), [Text.UTF8Encoding]::new($false))
}

Write-Host ('Repository: ' + $repoRoot)
Write-Host ('Claude: ' + $claudeCommand.Source)
Write-Host ('Bun: ' + (& bun --version))
Write-Host ('Discord plugin enabled for this repo: ' + $pluginEnabled)
Write-Host ('Discord state directory: ' + $stateDir)
Write-Host ('Owner allowlisted, project channel #' + $config.project_channel_name + ' enabled.')
if ($Check) { return }
if (-not $pluginEnabled -and -not $NoDiscord) {
    throw "Enable the Discord plugin for this repo: add enabledPlugins.'$pluginId' = true to .claude/settings.local.json."
}

$previousToken = $env:DISCORD_BOT_TOKEN
$previousStateDir = $env:DISCORD_STATE_DIR
$secureSaved = $null
$tokenPointer = [IntPtr]::Zero
try {
    if (-not $NoDiscord) {
        # DPAPI: readable only by this Windows account. The plaintext lives only in this process
        # environment for the lifetime of the Claude session; Claude's own subprocesses inherit it,
        # which is how the plugin's MCP server receives it.
        $secureSaved = ConvertTo-SecureString -String ([IO.File]::ReadAllText($tokenPath))
        $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSaved)
        $env:DISCORD_BOT_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
        $env:DISCORD_STATE_DIR = $stateDir
    }
    # The lead runs on Fable 5.1 (user decision, 2026-11-09, D036); specialists stay on Sonnet in
    # their profiles. To move the lead back to Opus, change this model and .claude/agents/lead-architect.md.
    $claudeArguments = @('--agent', 'lead-architect', '--model', 'claude-fable-5-1', '--permission-mode', 'auto', '--effort', 'high')
    if (-not $NoDiscord) { $claudeArguments += @('--channels', "plugin:$pluginId") }
    if ($Resume) { $claudeArguments += '--resume' }
    Push-Location -LiteralPath $repoRoot
    try {
        & $claudeCommand.Source @claudeArguments
        $claudeExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
} finally {
    $env:DISCORD_BOT_TOKEN = $previousToken
    $env:DISCORD_STATE_DIR = $previousStateDir
    if ($tokenPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
    if ($secureSaved) { $secureSaved.Dispose() }
}
exit $claudeExitCode
