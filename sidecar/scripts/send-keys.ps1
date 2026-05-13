param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('continue','approve','reject','interrupt','resume','focus')]
    [string]$Command,

    [int]$ClaudePid
)

$ErrorActionPreference = 'Stop'

$keys = switch ($Command) {
    'continue'  { 'continue{ENTER}' }
    'approve'   { 'y{ENTER}' }
    'reject'    { 'n{ENTER}' }
    'interrupt' { '{ESC}' }
    'resume'    { '/resume{ENTER}' }
    'focus'     { $null }
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MxWin32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

function Get-TargetHwnd {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return [IntPtr]::Zero }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) { return [IntPtr]::Zero }
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { return $proc.MainWindowHandle }
    # Claude Code's TUI may not own a window — walk up to the hosting terminal.
    $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId").ParentProcessId
    if ($parentId) {
        $parent = Get-Process -Id $parentId -ErrorAction SilentlyContinue
        if ($parent -and $parent.MainWindowHandle -ne [IntPtr]::Zero) {
            return $parent.MainWindowHandle
        }
    }
    return [IntPtr]::Zero
}

$hwnd = Get-TargetHwnd -ProcessId $ClaudePid

# Safety: never blast keystrokes at an unknown foreground window.
# If we can't confirm we have a real Claude Code terminal handle,
# refuse rather than risk typing into Chrome, Outlook, etc.
if ($hwnd -eq [IntPtr]::Zero) {
    Write-Error "send-keys: no target window for ClaudePid=$ClaudePid; refusing to send '$Command' to foreground."
    exit 2
}

[MxWin32]::ShowWindow($hwnd, 9) | Out-Null   # SW_RESTORE
[MxWin32]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 80

if ($keys) {
    [System.Windows.Forms.SendKeys]::SendWait($keys)
}
