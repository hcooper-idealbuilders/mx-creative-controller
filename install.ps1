# Install mx-creative-controller as Windows Scheduled Tasks that auto-start
# on user logon. Requires admin (Scheduled Task registration is privileged).
#
# Usage:
#   .\install.ps1            # build + register, but don't start now
#   .\install.ps1 -StartNow  # also kill any dev (tsx) processes and start the tasks
#
[CmdletBinding()]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'

# Self-elevate.
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Requires admin — relaunching elevated...' -ForegroundColor Yellow
    $args = if ($StartNow) { '-StartNow' } else { '' }
    Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",$args
    exit
}

$Root = $PSScriptRoot
$LogsDir = Join-Path $Root 'logs'
if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir | Out-Null }

# Resolve node.exe (must be on PATH or in nvm's currently-active version).
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw 'node.exe not found on PATH. Install Node 22 LTS or newer and re-run.' }
$nodeExe = $nodeCmd.Source
Write-Host "node: $nodeExe"

function Build-Package($name) {
    $dir = Join-Path $Root $name
    Write-Host ""
    Write-Host "==> Building $name" -ForegroundColor Cyan
    Push-Location $dir
    try {
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed in $name" }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed in $name" }
    } finally { Pop-Location }
}

Build-Package 'sidecar'
Build-Package 'keypad'

function Register-Task($name, $workdir, $logfile, $launcherPath) {
    Write-Host ""
    Write-Host "==> Registering Scheduled Task: $name" -ForegroundColor Cyan

    # Per-task launcher. We use Start-Process -RedirectStandardOutput rather
    # than PowerShell's *>> operator because the latter takes an exclusive
    # write lock on the log file for the entire lifetime of the PowerShell
    # process — and that handle leaks if node crashes, blocking the next
    # restart attempt.
    $logErr = $logfile -replace '\.log$', '.err'
    $launcher = @"
`$ErrorActionPreference = 'Stop'
`$proc = Start-Process -FilePath '$nodeExe' ``
    -ArgumentList 'dist\index.js' ``
    -WorkingDirectory '$workdir' ``
    -RedirectStandardOutput '$logfile' ``
    -RedirectStandardError  '$logErr' ``
    -NoNewWindow -PassThru -Wait
exit `$proc.ExitCode
"@
    Set-Content -Path $launcherPath -Value $launcher -Encoding UTF8

    $action = New-ScheduledTaskAction `
        -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""

    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit (New-TimeSpan -Days 365) `
        -MultipleInstances IgnoreNew `
        -Hidden

    # Run as the current user, only when logged on.
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Host "    registered."
}

$LaunchersDir = Join-Path $Root 'launchers'
if (-not (Test-Path $LaunchersDir)) { New-Item -ItemType Directory -Path $LaunchersDir | Out-Null }

$sidecarLog      = Join-Path $LogsDir 'sidecar.log'
$keypadLog       = Join-Path $LogsDir 'keypad.log'
$sidecarLauncher = Join-Path $LaunchersDir 'run-sidecar.ps1'
$keypadLauncher  = Join-Path $LaunchersDir 'run-keypad.ps1'

Register-Task 'mx-sidecar' (Join-Path $Root 'sidecar') $sidecarLog $sidecarLauncher
Register-Task 'mx-keypad'  (Join-Path $Root 'keypad')  $keypadLog  $keypadLauncher

Write-Host ""
Write-Host 'Installed.' -ForegroundColor Green
Write-Host "Logs: $LogsDir"
Write-Host ''

if ($StartNow) {
    Write-Host '==> -StartNow: stopping any dev (tsx) node processes, then starting tasks' -ForegroundColor Cyan
    # Kill node processes whose path is inside this repo (so we don't nuke the user's other node apps).
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.CommandLine -and ($_.CommandLine -like "*Hardware-interface*")
    } | ForEach-Object {
        Write-Host "    killing pid $($_.ProcessId): $($_.CommandLine.Substring(0, [Math]::Min(80, $_.CommandLine.Length)))..."
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
    Start-ScheduledTask -TaskName 'mx-sidecar'
    Start-ScheduledTask -TaskName 'mx-keypad'
    Write-Host 'Tasks started.' -ForegroundColor Green
} else {
    Write-Host 'Tasks will auto-start on next logon.'
    Write-Host 'To start now without logging out, run: .\install.ps1 -StartNow'
}
