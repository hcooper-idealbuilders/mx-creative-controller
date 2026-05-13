param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('continue','yes','no','interrupt','focus')]
    [string]$Command,

    [int]$ClaudePid
)

$ErrorActionPreference = 'Stop'

$keys = switch ($Command) {
    'continue'  { 'continue{ENTER}' }
    'yes'       { 'y{ENTER}' }
    'no'        { 'n{ENTER}' }
    'interrupt' { '{ESC}' }
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
if ($hwnd -eq [IntPtr]::Zero) {
    # Fallback: send to whichever window currently has focus.
    $hwnd = [MxWin32]::GetForegroundWindow()
}

if ($hwnd -ne [IntPtr]::Zero) {
    [MxWin32]::ShowWindow($hwnd, 9) | Out-Null   # SW_RESTORE
    [MxWin32]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 80
}

if ($keys) {
    [System.Windows.Forms.SendKeys]::SendWait($keys)
}
