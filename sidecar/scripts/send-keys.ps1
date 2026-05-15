param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('approve','focus','effort-low','effort-medium','effort-high','effort-xhigh')]
    [string]$Command,

    [int]$ClaudePid,

    # Direct window handle — preferred over PID when available (captured by
    # the hook at session start). Pass 0 if unknown.
    [int64]$ClaudeHwnd,

    # Optional disambiguator when window can't be resolved by handle or PID.
    # The fallback terminal search prefers windows whose title contains this.
    [string]$ProjectHint
)

$ErrorActionPreference = 'Stop'

$keys = switch ($Command) {
    # Claude Code permission prompts show a numbered menu (1. Yes / 2. ... / 3. No).
    # Typing the literal "1" + Enter selects option 1 reliably, regardless of
    # which row is highlighted. "y" is not a documented binding and was being
    # silently dropped.
    'approve'       { '1{ENTER}' }
    'focus'         { $null }
    'effort-low'    { '/effort low{ENTER}' }
    'effort-medium' { '/effort medium{ENTER}' }
    'effort-high'   { '/effort high{ENTER}' }
    'effort-xhigh'  { '/effort xhigh{ENTER}' }
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

$TERMINAL_NAMES = @('powershell','pwsh','WindowsTerminal','WindowsTerminalPreview','conhost','cmd','OpenConsole')

function Get-HwndByPid {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return [IntPtr]::Zero }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) { return [IntPtr]::Zero }
    # Only accept the handle if the process is a known terminal — never
    # return e.g. explorer.exe's window if a stale PID lands here.
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero -and $TERMINAL_NAMES -contains $proc.ProcessName) {
        return $proc.MainWindowHandle
    }
    return [IntPtr]::Zero
}

# Fallback: only consider processes that are obviously terminals,
# preferring one whose window title matches the session's project name
# (so two Claude Code sessions in two terminals can be told apart),
# then falling back to any "Claude"-titled terminal.
function Find-LikelyClaudeTerminal {
    param([string]$ProjectHint)
    $terminals = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.MainWindowHandle -ne [IntPtr]::Zero -and
        $TERMINAL_NAMES -contains $_.ProcessName
    }
    if ($ProjectHint) {
        $byProject = $terminals | Where-Object { $_.MainWindowTitle -match [regex]::Escape($ProjectHint) }
        if ($byProject) { return $byProject[0].MainWindowHandle }
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

# Resolve the target window: direct HWND first, then PID, then fallback search.
$hwnd = [IntPtr]::Zero
if ($ClaudeHwnd -gt 0) { $hwnd = [IntPtr]$ClaudeHwnd }
if ($hwnd -eq [IntPtr]::Zero) { $hwnd = Get-HwndByPid -ProcessId $ClaudePid }
if ($hwnd -eq [IntPtr]::Zero) { $hwnd = Find-LikelyClaudeTerminal -ProjectHint $ProjectHint }

if ($hwnd -eq [IntPtr]::Zero) {
    Write-Error "send-keys: no Claude terminal found (ClaudePid=$ClaudePid). Refusing to send '$Command'."
    exit 2
}

Force-Foreground -Hwnd $hwnd
Start-Sleep -Milliseconds 80

if ($keys) {
    [System.Windows.Forms.SendKeys]::SendWait($keys)
}
