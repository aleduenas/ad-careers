[CmdletBinding(DefaultParameterSetName = 'Launch')]
param(
    [Parameter(ParameterSetName = 'Configure', Mandatory = $true)]
    [switch]$Configure,
    [Parameter(ParameterSetName = 'Check', Mandatory = $true)]
    [switch]$Check,
    [Parameter(ParameterSetName = 'TestDm', Mandatory = $true)]
    [switch]$TestDm,
    [Parameter(ParameterSetName = 'Login', Mandatory = $true)]
    [switch]$Login,
    [Parameter(ParameterSetName = 'ProjectChannel', Mandatory = $true)]
    [string]$ProjectChannel,
    [Parameter(ParameterSetName = 'ProjectChannel')]
    [switch]$Apply,
    [Parameter(ParameterSetName = 'TestChannel', Mandatory = $true)]
    [switch]$TestChannel,
    [Parameter(ParameterSetName = 'Launch')]
    [switch]$Terminal,
    [Parameter(ParameterSetName = 'ReloadDiscord', Mandatory = $true)]
    [switch]$ReloadDiscord,
    [string]$CodexPath
)

$ErrorActionPreference = 'Stop'
# Use the same root authority as Node launchers, including when called from another directory.
Push-Location -LiteralPath $PSScriptRoot
try {
    $repoRoot = 'import { root } from "../lib/root.mjs"; console.log(root);' | & node --input-type=module -
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve the repository root. Check Node installation.' }
} finally {
    Pop-Location
}
$configPath = Join-Path $repoRoot 'config\discord-lead.json'
$tokenPath = Join-Path $repoRoot 'config\discord-lead-token.dpapi'
function Resolve-CodexExecutable {
    param([string]$ExplicitPath, [string]$SettingsPath)

    if ($ExplicitPath) {
        if ([IO.Path]::GetExtension($ExplicitPath) -ne '.exe' -or
            -not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) {
            throw '-CodexPath must name an existing native Codex .exe file.'
        }
        return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }

    $candidates = [Collections.Generic.List[string]]::new()
    if (Test-Path -LiteralPath $SettingsPath) {
        $savedSettings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
        if ($savedSettings.codex_command) { $candidates.Add([string]$savedSettings.codex_command) }
    }
    $pathCommand = Get-Command codex -CommandType Application -ErrorAction SilentlyContinue |
        Where-Object { [IO.Path]::GetExtension($_.Source) -eq '.exe' } |
        Select-Object -First 1
    if ($pathCommand) { $candidates.Add($pathCommand.Source) }

    # Editor-bundled Codex is normally absent from a separately opened terminal's PATH.
    $extensionRoots = @(
        (Join-Path $env:USERPROFILE '.vscode\extensions'),
        (Join-Path $env:USERPROFILE '.vscode-insiders\extensions'),
        (Join-Path $env:USERPROFILE '.cursor\extensions')
    )
    $platformFolder = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
        'windows-aarch64'
    } else { 'windows-x86_64' }
    foreach ($extensionRoot in $extensionRoots) {
        if (-not (Test-Path -LiteralPath $extensionRoot -PathType Container)) { continue }
        $extensions = Get-ChildItem -LiteralPath $extensionRoot -Directory -Filter 'openai.chatgpt-*' |
            Sort-Object LastWriteTime -Descending
        foreach ($extension in $extensions) {
            $candidates.Add((Join-Path $extension.FullName "bin\$platformFolder\codex.exe"))
        }
    }
    foreach ($candidate in $candidates) {
        if ([IO.Path]::GetExtension($candidate) -eq '.exe' -and
            (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw 'Native Codex executable not found. Supply -CodexPath with its full .exe path, or install Codex CLI. Checked saved configuration, PATH and editor extensions.'
}

$codexExecutable = Resolve-CodexExecutable -ExplicitPath $CodexPath -SettingsPath $configPath
Write-Host ('Codex executable: ' + $codexExecutable)
if ($ReloadDiscord) {
    & node (Join-Path $repoRoot 'src\helpers\discord-terminal.mjs') --reload
    exit $LASTEXITCODE
}
if ($Terminal) {
    # The runtime capability is readable only by this Windows account, including child files.
    $runtimeDirectory = Join-Path $repoRoot 'logs\dev-discord-lead\runtime'
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $runtimeAcl = New-Object System.Security.AccessControl.DirectorySecurity
    $runtimeSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $runtimeAcl.SetAccessRuleProtection($true, $false)
    $runtimeRule = New-Object System.Security.AccessControl.FileSystemAccessRule($runtimeSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $runtimeAcl.AddAccessRule($runtimeRule)
    # Persist only the changed DACL. Set-Acl can request audit/security privileges;
    # the directory's owner, group and audit rules must stay untouched.
    [IO.Directory]::SetAccessControl($runtimeDirectory, $runtimeAcl)
}
if ($Login) {
    & $codexExecutable login
    exit $LASTEXITCODE
}

if ($Configure) {
    $ownerId = (Read-Host 'Your Discord user ID (Developer Mode > right-click yourself > Copy User ID)').Trim()
    if ($ownerId -notmatch '^[0-9]{17,20}$') { throw 'Enter your numeric Discord user ID, not a name or bot ID.' }
    $secureToken = Read-Host 'Paste the separate career-ops Discord BOT token (hidden)' -AsSecureString
    try {
        if ($secureToken.Length -eq 0) { throw 'The token cannot be empty.' }
        # Windows DPAPI: encrypted for this Windows account; no plaintext token is written.
        $encryptedToken = ConvertFrom-SecureString -SecureString $secureToken
        [IO.File]::WriteAllText($tokenPath, $encryptedToken, [Text.UTF8Encoding]::new($false))
        $settings = [ordered]@{ owner_id = $ownerId; codex_command = $codexExecutable }
        if (Test-Path -LiteralPath $configPath) {
            $previousSettings = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
            foreach ($routeKey in @('project_channel_id', 'project_guild_id', 'project_channel_name')) {
                if ($previousSettings.$routeKey) { $settings[$routeKey] = $previousSettings.$routeKey }
            }
        }
        [IO.File]::WriteAllText($configPath, (($settings | ConvertTo-Json) + "`n"), [Text.UTF8Encoding]::new($false))
    } finally {
        $secureToken.Dispose()
        $encryptedToken = $null
    }
    Write-Host 'Saved local owner allowlist and encrypted bot token. No Discord messages were sent.'
    Write-Host 'Next: run this launcher with -Check, then -TestDm, then without switches.'
    return
}

$previousToken = $env:DISCORD_LEAD_BOT_TOKEN
$previousCodexCommand = $env:CAREER_DISCORD_CODEX_COMMAND
$secureSaved = $null
$tokenPointer = [IntPtr]::Zero
try {
    $env:CAREER_DISCORD_CODEX_COMMAND = $codexExecutable
    if (-not $env:DISCORD_LEAD_BOT_TOKEN -and (Test-Path -LiteralPath $tokenPath)) {
        $secureSaved = ConvertTo-SecureString -String ([IO.File]::ReadAllText($tokenPath))
        $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSaved)
        $env:DISCORD_LEAD_BOT_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    }
    $nodeArgs = @((Join-Path $repoRoot 'src\helpers\discord-lead.mjs'))
    if ($Terminal) { $nodeArgs = @((Join-Path $repoRoot 'src\helpers\discord-terminal.mjs')) }
    if ($Check) { $nodeArgs += '--check' }
    if ($TestDm) { $nodeArgs += '--test-dm' }
    if ($TestChannel) { $nodeArgs += '--test-channel' }
    if ($ProjectChannel) {
        $nodeArgs += ('--project-channel=' + $ProjectChannel)
        if ($Apply) { $nodeArgs += '--apply' }
    }
    & node @nodeArgs
    $bridgeExitCode = $LASTEXITCODE
} finally {
    $env:DISCORD_LEAD_BOT_TOKEN = $previousToken
    $env:CAREER_DISCORD_CODEX_COMMAND = $previousCodexCommand
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }
    if ($secureSaved) { $secureSaved.Dispose() }
}
exit $bridgeExitCode
