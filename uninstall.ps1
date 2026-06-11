# Stop and unregister the mx-sidecar and mx-keypad Scheduled Tasks.
# Leaves source, dist/, and logs/ in place so re-installing is fast.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Requires admin — relaunching elevated...' -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`""
    exit
}

foreach ($name in @('mx-sidecar','mx-keypad')) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if (-not $task) { Write-Host "$name not installed — skipping."; continue }
    Write-Host "Stopping $name..."
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Write-Host "Unregistering $name..."
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
}

# Stop-ScheduledTask kills the launcher wrapper but NOT the detached node
# child — reap it via the PID file the launcher maintains.
foreach ($svc in @('sidecar','keypad')) {
    $pidFile = Join-Path $PSScriptRoot "logs\$svc.pid"
    if (-not (Test-Path $pidFile)) { continue }
    $nodePid = [int](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $proc = Get-Process -Id $nodePid -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'node') {
        Write-Host "Stopping orphaned $svc node process (pid $nodePid)..."
        $proc | Stop-Process -Force
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
Write-Host 'Uninstalled.' -ForegroundColor Green
