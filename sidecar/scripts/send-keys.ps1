param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('approve','focus','fast','effort-low','effort-medium','effort-high','effort-xhigh')]
    [string]$Command,

    [int]$ClaudePid,

    # Direct window handle — preferred over PID when available (captured by
    # the hook at session start). Pass 0 if unknown.
    [int64]$ClaudeHwnd,

    # Optional disambiguator when window can't be resolved by handle or PID.
    # The fallback terminal search prefers windows whose title contains this.
    [string]$ProjectHint,

    # The session's tab title (captured by the hook while that tab was
    # provably active). Used with -RequireTabMatch.
    [string]$TabTitle,

    # Set when MULTIPLE sessions share the target window (multi-tab WT).
    # Keys must then only be sent once the active tab's title matches
    # TabTitle — cycling tabs with Ctrl+Tab to find it — or not at all.
    [switch]$RequireTabMatch
)

$ErrorActionPreference = 'Stop'

$keys = switch ($Command) {
    # Claude Code permission prompts show a numbered menu (1. Yes / 2. ... / 3. No).
    # Typing the literal "1" + Enter selects option 1 reliably, regardless of
    # which row is highlighted. "y" is not a documented binding and was being
    # silently dropped.
    'approve'       { '1{ENTER}' }
    'focus'         { $null }
    'fast'          { '/fast{ENTER}' }
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
    // Separate signature with an out parameter so we can recover the PID
    // behind a foreground hwnd — used to log which app blocked a focus steal.
    [DllImport("user32.dll", EntryPoint="GetWindowThreadProcessId")] public static extern uint GetWindowThreadProcessIdOut(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    // Synthetic ALT tap: a process that has "sent input" is allowed to call
    // SetForegroundWindow even under the foreground lock. VK_MENU = 0x12,
    // KEYEVENTF_KEYUP = 0x02.
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
}
"@

# Zero the foreground lock timeout for this desktop session (volatile — no
# SPIF_UPDATEINIFILE, so it resets at logon; we re-apply per press). Without
# this, an actively-used app (observed: chrome during a click-storm) wins the
# foreground fight against every escalation level and Approve gets refused.
# SPI_SETFOREGROUNDLOCKTIMEOUT = 0x2001, SPIF_SENDCHANGE = 0x2.
[void][MxWin32]::SystemParametersInfo(0x2001, 0, [IntPtr]::Zero, 0x2)

# Resolve the process name that owns a window handle. Used purely for
# diagnostic logging — never for control flow — so we swallow all errors
# and return '' on any failure path.
function Get-HwndProcessName {
    param([IntPtr]$Hwnd)
    if ($Hwnd -eq [IntPtr]::Zero) { return '' }
    try {
        $procId = [uint32]0
        [void][MxWin32]::GetWindowThreadProcessIdOut($Hwnd, [ref]$procId)
        if ($procId -eq 0) { return '' }
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) { return $p.ProcessName }
    } catch { }
    return ''
}

# Per-press structured log so we can see how often Windows blocks the focus
# steal and which app was holding foreground at the time. Tab-separated for
# easy awk/Select-String. Best-effort — never throws.
function Write-PressLog {
    param([string]$Outcome, [IntPtr]$TargetHwnd, [IntPtr]$ForegroundHwnd, [string]$Detail = '')
    try {
        $logDir = 'C:\Users\hdcooper\IB\projects\hardware-interface\logs'
        if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
        $targetProc = Get-HwndProcessName -Hwnd $TargetHwnd
        $fgProc     = Get-HwndProcessName -Hwnd $ForegroundHwnd
        $line = "$(Get-Date -Format 'o')`t$Command`t$Outcome`ttarget=$TargetHwnd($targetProc)`tfg=$ForegroundHwnd($fgProc)`t$Detail"
        Add-Content -Path (Join-Path $logDir 'send-keys.log') -Value $line -Encoding UTF8
    } catch { }
}

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

# Focus + verify. SetForegroundWindow can silently fail when Windows denies
# focus-steal (very common when another app like Excel currently holds
# foreground). Without verifying, SendKeys::SendWait would then type "1{ENTER}"
# into whatever is foreground — Hunter's Excel cell, his browser address bar,
# etc. We poll GetForegroundWindow until it matches the target or we time out,
# then return whether focus actually landed where we expected.
function Test-Foreground {
    param([IntPtr]$Hwnd, [int]$TimeoutMs)
    $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
    while ((Get-Date) -lt $deadline) {
        if ([MxWin32]::GetForegroundWindow() -eq $Hwnd) { return $true }
        Start-Sleep -Milliseconds 15
    }
    return $false
}

# Three escalating attempts — Windows refuses SetForegroundWindow when the
# user is actively typing elsewhere (foreground lock), and the plain
# AttachThreadInput trick alone loses that fight:
#   1. AttachThreadInput trick (cheap, works when there's no contention)
#   2. + synthetic ALT tap: after keybd_event this process counts as the
#      last input sender, which exempts it from the foreground lock
#   3. + minimize/restore bounce: a window being restored gets foreground
#      by design, even under lock
function Set-ForegroundAndVerify {
    param([IntPtr]$Hwnd, [int]$TimeoutMs = 300)
    if ($Hwnd -eq [IntPtr]::Zero) { return $false }

    Force-Foreground -Hwnd $Hwnd
    if (Test-Foreground -Hwnd $Hwnd -TimeoutMs $TimeoutMs) { return $true }

    [MxWin32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)      # ALT down
    [MxWin32]::keybd_event(0x12, 0, 0x02, [UIntPtr]::Zero)   # ALT up
    Force-Foreground -Hwnd $Hwnd
    if (Test-Foreground -Hwnd $Hwnd -TimeoutMs $TimeoutMs) { return $true }

    [MxWin32]::ShowWindow($Hwnd, 6) | Out-Null   # SW_MINIMIZE
    Start-Sleep -Milliseconds 60
    [MxWin32]::ShowWindow($Hwnd, 9) | Out-Null   # SW_RESTORE
    Force-Foreground -Hwnd $Hwnd
    return (Test-Foreground -Hwnd $Hwnd -TimeoutMs ($TimeoutMs + 200))
}

# ---- Tab targeting (multi-tab Windows Terminal) ----
# One WT window hosts many tabs; the window title IS the active tab's title.
# Claude Code titles its tab with the task summary plus a status glyph
# (e.g. "⠂ Investigate project after folder restructuring"), so we strip
# leading non-alphanumerics before comparing.

function Get-NormalizedWindowTitle {
    param([IntPtr]$Hwnd)
    $sb = New-Object System.Text.StringBuilder 512
    [void][MxWin32]::GetWindowText($Hwnd, $sb, 512)
    return ($sb.ToString() -replace '^[^\p{L}\p{N}]+', '').Trim()
}

function Test-TitleMatch {
    param([string]$Current, [string]$Want)
    if (-not $Current -or -not $Want) { return $false }
    $c = $Current.ToLowerInvariant(); $w = $Want.ToLowerInvariant()
    # Containment either way: the live title may have grown a suffix, or the
    # stored one may be a truncation. Tiny strings must match exactly.
    if ($c.Length -lt 4 -or $w.Length -lt 4) { return $c -eq $w }
    return ($c.Contains($w) -or $w.Contains($c))
}

# Cycle tabs (Ctrl+Tab) until the active tab's title matches the session's
# stored tab title. The window must already be foreground. Returns $true when
# the right tab is active. A full lap without a match → $false (the stored
# title drifted, or the tab closed) — caller must NOT type.
function Select-TargetTab {
    param([IntPtr]$Hwnd, [string]$WantTitle, [int]$MaxTabs = 9)
    $want = ($WantTitle -replace '^[^\p{L}\p{N}]+', '').Trim()
    if (-not $want) { return $false }
    for ($i = 0; $i -lt $MaxTabs; $i++) {
        $current = Get-NormalizedWindowTitle -Hwnd $Hwnd
        if (Test-TitleMatch -Current $current -Want $want) { return $true }
        [System.Windows.Forms.SendKeys]::SendWait('^{TAB}')
        Start-Sleep -Milliseconds 180
    }
    return $false
}

# Resolve the target window: direct HWND first, then PID, then fallback search.
$hwnd = [IntPtr]::Zero
if ($ClaudeHwnd -gt 0) { $hwnd = [IntPtr]$ClaudeHwnd }
if ($hwnd -eq [IntPtr]::Zero) { $hwnd = Get-HwndByPid -ProcessId $ClaudePid }
if ($hwnd -eq [IntPtr]::Zero) { $hwnd = Find-LikelyClaudeTerminal -ProjectHint $ProjectHint }

if ($hwnd -eq [IntPtr]::Zero) {
    Write-PressLog -Outcome 'NO-TARGET' -TargetHwnd ([IntPtr]::Zero) -ForegroundHwnd ([MxWin32]::GetForegroundWindow()) -Detail "ClaudePid=$ClaudePid"
    Write-Error "send-keys: no Claude terminal found (ClaudePid=$ClaudePid). Refusing to send '$Command'."
    exit 2
}

# Capture the foreground window before we steal focus, so we can put it
# back afterward. SendKeys::SendWait requires the target window to be in
# the foreground — there's no in-place "type into HWND" path that works
# reliably through Windows Terminal's ConPTY. The right user experience
# is therefore: focus → verify → type → restore. The 'focus' command
# intentionally skips the verify-and-restore (its whole point is to leave
# Claude in front; a focus-steal denial there is harmless).
$prevForeground = if ($keys) { [MxWin32]::GetForegroundWindow() } else { [IntPtr]::Zero }

if ($keys) {
    if (-not (Set-ForegroundAndVerify -Hwnd $hwnd)) {
        # Windows denied the focus steal — the target never came forward.
        # Sending now would type the keys into whatever IS foreground
        # (Excel, browser, etc). Abort instead, and let the sidecar surface
        # this as a press-failed error on the keypad (red border).
        $fg = [MxWin32]::GetForegroundWindow()
        Write-PressLog -Outcome 'DENIED' -TargetHwnd $hwnd -ForegroundHwnd $fg
        Write-Error "send-keys: target window did not come to foreground (hwnd=$hwnd, foreground=$fg). Refusing to send '$Command'."
        exit 3
    }
    if ($RequireTabMatch) {
        # Multiple sessions share this window — typing into the active tab
        # would hit a SIBLING session. Find this session's tab first.
        if (-not (Select-TargetTab -Hwnd $hwnd -WantTitle $TabTitle)) {
            Write-PressLog -Outcome 'TAB-NOT-FOUND' -TargetHwnd $hwnd -ForegroundHwnd $prevForeground -Detail "want=$TabTitle"
            if ($prevForeground -ne [IntPtr]::Zero -and $prevForeground -ne $hwnd) {
                Force-Foreground -Hwnd $prevForeground
            }
            Write-Error "send-keys: shared window and the session's tab couldn't be located (want title ~ '$TabTitle'). Refusing to send '$Command'."
            exit 4
        }
    }
    [System.Windows.Forms.SendKeys]::SendWait($keys)
    Write-PressLog -Outcome 'OK' -TargetHwnd $hwnd -ForegroundHwnd $prevForeground -Detail "keys=$keys"
    # Restore prior foreground unless it was Claude itself (then there's
    # nothing to restore). Brief settle so SendKeys finishes its synthetic
    # input queue before we pull focus away.
    if ($prevForeground -ne [IntPtr]::Zero -and $prevForeground -ne $hwnd) {
        Start-Sleep -Milliseconds 40
        Force-Foreground -Hwnd $prevForeground
    }
} else {
    # 'focus' command: bringing the window forward IS the deliverable, so use
    # the full escalation. Still no hard failure — worst case the taskbar
    # button flashes (Windows' consolation prize when it denies the steal).
    $fgBefore = [MxWin32]::GetForegroundWindow()
    $landed = Set-ForegroundAndVerify -Hwnd $hwnd
    # Best-effort tab switch: focusing the window with a sibling session's
    # tab on top isn't what the user meant by "Focus".
    if ($landed -and $RequireTabMatch) {
        $null = Select-TargetTab -Hwnd $hwnd -WantTitle $TabTitle
    }
    $outcome = if ($landed) { 'FOCUS' } else { 'FOCUS-DENIED' }
    Write-PressLog -Outcome $outcome -TargetHwnd $hwnd -ForegroundHwnd $fgBefore
}
