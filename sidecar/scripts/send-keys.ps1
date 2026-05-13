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
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@

function Get-HwndByPid {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return [IntPtr]::Zero }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) { return [IntPtr]::Zero }
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { return $proc.MainWindowHandle }
    # Walk up to a window-owning ancestor.
    $walk = $ProcessId
    for ($i = 0; $i -lt 6; $i++) {
        $walk = (Get-CimInstance Win32_Process -Filter "ProcessId=$walk" -ErrorAction SilentlyContinue).ParentProcessId
        if (-not $walk) { break }
        $parent = Get-Process -Id $walk -ErrorAction SilentlyContinue
        if ($parent -and $parent.MainWindowHandle -ne [IntPtr]::Zero) {
            return $parent.MainWindowHandle
        }
    }
    return [IntPtr]::Zero
}

# Fallback: only consider processes that are obviously terminals,
# preferring one whose window title looks like Claude Code.
function Find-LikelyClaudeTerminal {
    $terminals = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.MainWindowHandle -ne [IntPtr]::Zero -and
        $_.ProcessName -in @('powershell','pwsh','WindowsTerminal','conhost','cmd')
    }
    $byClaude = $terminals | Where-Object { $_.MainWindowTitle -match 'Claude' }
    if ($byClaude) { return $byClaude[0].MainWindowHandle }
    if ($terminals) { return $terminals[0].MainWindowHandle }
    return [IntPtr]::Zero
}

# Bring a window to the foreground reliably across Windows' focus-steal protection.
# Standard AttachThreadInput trick.
function Force-Foreground {
    param([IntPtr]$Hwnd)
    if ($Hwnd -eq [IntPtr]::Zero) { return }
    if ([MxWin32]::IsIconic($Hwnd)) { [MxWin32]::ShowWindow($Hwnd, 9) | Out-Null }  # SW_RESTORE
    $foregroundHwnd = [MxWin32]::GetForegroundWindow()
    $currentThread  = [MxWin32]::GetWindowThreadProcessId($foregroundHwnd, [IntPtr]::Zero)
    $targetThread   = [MxWin32]::GetWindowThreadProcessId($Hwnd, [IntPtr]::Zero)
    if ($currentThread -ne $targetThread) {
        [MxWin32]::AttachThreadInput($currentThread, $targetThread, $true) | Out-Null
        [MxWin32]::SetForegroundWindow($Hwnd) | Out-Null
        [MxWin32]::BringWindowToTop($Hwnd) | Out-Null
        [MxWin32]::AttachThreadInput($currentThread, $targetThread, $false) | Out-Null
    } else {
        [MxWin32]::SetForegroundWindow($Hwnd) | Out-Null
        [MxWin32]::BringWindowToTop($Hwnd) | Out-Null
    }
}

# Resolve the target window: PID first, then fall back to "looks like a Claude terminal."
$hwnd = Get-HwndByPid -ProcessId $ClaudePid
if ($hwnd -eq [IntPtr]::Zero) { $hwnd = Find-LikelyClaudeTerminal }

if ($hwnd -eq [IntPtr]::Zero) {
    Write-Error "send-keys: no Claude terminal found (ClaudePid=$ClaudePid). Refusing to send '$Command'."
    exit 2
}

Force-Foreground -Hwnd $hwnd
Start-Sleep -Milliseconds 80

if ($keys) {
    [System.Windows.Forms.SendKeys]::SendWait($keys)
}
