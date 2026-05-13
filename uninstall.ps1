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
Write-Host 'Uninstalled.' -ForegroundColor Green
