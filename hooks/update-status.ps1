param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('SessionStart','UserPromptSubmit','Stop','Notification','SessionEnd','PreToolUse','PostToolUse')]
    [string]$Event
)

# SessionEnd is special: we just remove the file. "Ended" isn't a state we
# display — the keypad shows current sessions only. /resume gives us a fresh
# session_id anyway, so persisting the predecessor only causes UI confusion.
if ($Event -eq 'SessionEnd') {
    $hookJson = [Console]::In.ReadToEnd()
    $payload = if ($hookJson) { try { $hookJson | ConvertFrom-Json } catch { $null } } else { $null }
    if ($payload -and $payload.session_id) {
        $sessionsDir = Join-Path $env:USERPROFILE '.claude\mx-sessions'
        $path = Join-Path $sessionsDir "$([string]$payload.session_id).json"
        if (Test-Path $path) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
    }
    try {
        Add-Content -Path 'C:\Users\hdcooper\IB\projects\hardware-interface\logs\hooks-debug.log' `
                    -Value "$(Get-Date -Format 'o')`tSessionEnd-DELETED`t$($payload.session_id)" -Encoding UTF8
    } catch { }
    return
}

$ErrorActionPreference = 'Stop'

# Debug log so we can verify every hook invocation, not just the "last_event"
# that survives in the session file. Tail logs/hooks-debug.log to see firings.
try {
    $debugDir = 'C:\Users\hdcooper\IB\projects\hardware-interface\logs'
    if (-not (Test-Path $debugDir)) { New-Item -ItemType Directory -Path $debugDir -Force | Out-Null }
    $debugLine = "$(Get-Date -Format 'o')`t$Event`t$([System.IO.Path]::GetFileName($MyInvocation.MyCommand.Path))"
    Add-Content -Path (Join-Path $debugDir 'hooks-debug.log') -Value $debugLine -Encoding UTF8
} catch { }

$hookJson = [Console]::In.ReadToEnd()
$payload = if ($hookJson) {
    try { $hookJson | ConvertFrom-Json } catch { $null }
} else { $null }

# Need a session_id to track per-session state. Bail out quietly if absent
# (better than corrupting a global file).
if (-not $payload -or -not $payload.session_id) { return }
$sessionId = [string]$payload.session_id

# Per-session status files: ~/.claude/mx-sessions/<session_id>.json
$sessionsDir = Join-Path $env:USERPROFILE '.claude\mx-sessions'
if (-not (Test-Path $sessionsDir)) {
    New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null
}
$statusPath = Join-Path $sessionsDir "$sessionId.json"

# Load existing per-session status, or initialize.
# Always rebuild as a fully-shaped pscustomobject so missing fields from an
# older schema (e.g. pre-claude_hwnd files) get added on the next event.
$loaded = if (Test-Path $statusPath) {
    try { Get-Content $statusPath -Raw | ConvertFrom-Json } catch { $null }
} else { $null }

function Get-FieldOrDefault {
    param($obj, [string]$name, $default)
    if ($obj -and ($obj.PSObject.Properties.Name -contains $name)) { return $obj.$name }
    return $default
}

$nowIso = (Get-Date).ToUniversalTime().ToString('o')
$status = [pscustomobject]@{
    state         = Get-FieldOrDefault $loaded 'state'        'idle'
    project       = Get-FieldOrDefault $loaded 'project'      $null
    model         = Get-FieldOrDefault $loaded 'model'        $null
    fast_mode     = Get-FieldOrDefault $loaded 'fast_mode'    $false
    session_id    = $sessionId
    claude_pid    = Get-FieldOrDefault $loaded 'claude_pid'   $null
    claude_hwnd   = Get-FieldOrDefault $loaded 'claude_hwnd'  $null
    first_seen    = Get-FieldOrDefault $loaded 'first_seen'   $nowIso
    last_event    = Get-FieldOrDefault $loaded 'last_event'   $null
    last_updated  = Get-FieldOrDefault $loaded 'last_updated' $null
}

$status.state = switch ($Event) {
    'SessionStart'     { 'idle' }
    'UserPromptSubmit' { 'thinking' }
    'Stop'             { 'done' }
    'Notification'     { 'waiting_input' }
    # Tool use means Claude is actively working, even if a Notification
    # set us to waiting_input moments ago (e.g. an auto-approved permission
    # prompt left no follow-up signal). Flip back to thinking.
    'PreToolUse'       { 'thinking' }
    'PostToolUse'      { 'thinking' }
}

# Capture Notification message so the keypad can distinguish permission
# prompts (where Approve = '1⏎' is the right answer) from free-text input
# requests (where the user has to type a reply). Cleared on any non-
# Notification event so a stale message doesn't outlast its prompt.
if ($Event -eq 'Notification') {
    $msg = if ($payload -and $payload.message) { [string]$payload.message } else { '' }
    $status | Add-Member -NotePropertyName 'notification_message' -NotePropertyValue $msg -Force
    try {
        Add-Content -Path 'C:\Users\hdcooper\IB\projects\hardware-interface\logs\hooks-debug.log' `
                    -Value "$(Get-Date -Format 'o')`tNOTIFICATION-MSG`t$msg" -Encoding UTF8
    } catch { }
} else {
    $status | Add-Member -NotePropertyName 'notification_message' -NotePropertyValue $null -Force
}
$status.last_event   = $Event
$status.last_updated = (Get-Date).ToUniversalTime().ToString('o')

if ($payload.cwd)   { $status.project = Split-Path $payload.cwd -Leaf }
if ($payload.model) {
    $status.model = if ($payload.model.id) { $payload.model.id } else { [string]$payload.model }
}

# Terminal-class processes whose window we'd accept as "the Claude Code host".
# We exclude generic window-owners like explorer.exe because every desktop
# process eventually descends from explorer; accepting the first window
# ancestor would mis-capture it as the "Claude" PID.
$TERMINAL_NAMES = @('powershell','pwsh','WindowsTerminal','conhost','cmd','windowsterminalpreview')

# Seed cached resolutions from the previous hook fire. The earlier version
# wiped these unconditionally and re-ran a ~1s WMI + Get-Process scan on every
# hook event — including high-frequency PreToolUse/PostToolUse — which both
# burned latency and wiped good hwnds whenever the title-match heuristic
# happened to miss later in the session. Now we keep the cached values and
# only re-resolve when they're missing or no longer valid.
$cachedCodePid = Get-FieldOrDefault $loaded 'claude_code_pid' $null
$status | Add-Member -NotePropertyName 'claude_code_pid' -NotePropertyValue $cachedCodePid -Force

# Cheap liveness check: does the cached PID still own the cached hwnd?
# MainWindowHandle is stable for a process's lifetime, so handle equality is
# an exact validity test, not a heuristic.
function Test-WindowStillValid {
    param($ProcessId, $Hwnd)
    if (-not $ProcessId -or -not $Hwnd) { return $false }
    try {
        $p = Get-Process -Id $ProcessId -ErrorAction Stop
        return ($p.MainWindowHandle -ne [IntPtr]::Zero) -and ([int64]$p.MainWindowHandle -eq [int64]$Hwnd)
    } catch { return $false }
}

# SessionStart forces a fresh resolve (covers /resume onto a new terminal).
# Every other event reuses the cached hwnd when it's still valid.
$resolveWindow = ($Event -eq 'SessionStart') -or `
                 -not (Test-WindowStillValid $status.claude_pid $status.claude_hwnd)

# claude_code_pid is fixed for the session — re-walk only when missing or dead.
$resolveCodePid = -not $status.claude_code_pid
if ($status.claude_code_pid) {
    try { $null = Get-Process -Id $status.claude_code_pid -ErrorAction Stop }
    catch { $resolveCodePid = $true }
}

if ($resolveCodePid) {
    $status.claude_code_pid = $null
    try {
        $walkPid = $PID
        for ($i = 0; $i -lt 5; $i++) {
            $wmiProc = Get-CimInstance Win32_Process -Filter "ProcessId=$walkPid" -ErrorAction Stop
            if (-not $wmiProc -or -not $wmiProc.ParentProcessId) { break }
            $parentPid = [int]$wmiProc.ParentProcessId
            $parentProc = Get-Process -Id $parentPid -ErrorAction SilentlyContinue
            if ($parentProc -and ($parentProc.ProcessName -eq 'node' -or $parentProc.ProcessName -eq 'claude')) {
                $status.claude_code_pid = $parentPid
                break
            }
            $walkPid = $parentPid
        }
    } catch { }
}

if ($resolveWindow) {
    $status.claude_pid  = $null
    $status.claude_hwnd = $null
    # Walking the parent chain doesn't work because Windows Terminal hosts
    # shells via ConPTY, breaking the Windows process-tree relationship — WT
    # isn't in the parent chain of its hosted shells. So we look at every
    # terminal-class window on the desktop and prefer ones whose title
    # contains this session's project.
    try {
        $terminals = Get-Process -ErrorAction SilentlyContinue | Where-Object {
            $_.MainWindowHandle -ne [IntPtr]::Zero -and
            $TERMINAL_NAMES -contains $_.ProcessName
        }
        $picked = $null
        if ($status.project) {
            $picked = $terminals | Where-Object { $_.MainWindowTitle -match [regex]::Escape($status.project) } | Select-Object -First 1
        }
        if (-not $picked) {
            $picked = $terminals | Where-Object { $_.MainWindowTitle -match 'Claude' } | Select-Object -First 1
        }
        if ($picked) {
            $status.claude_pid  = [int]$picked.Id
            $status.claude_hwnd = [int64]$picked.MainWindowHandle
        }
    } catch { }
}

# Diagnostic — CACHED means we skipped the expensive scan this fire.
try {
    $mode = if ($resolveWindow) { 'RESOLVE' } else { 'CACHED' }
    $tag  = if ($status.claude_hwnd) { "$mode OK hwnd=$($status.claude_hwnd) pid=$($status.claude_pid)" } else { "$mode NOT-FOUND" }
    Add-Content -Path 'C:\Users\hdcooper\IB\projects\hardware-interface\logs\hooks-debug.log' `
                -Value "$(Get-Date -Format 'o')`tCAPTURE`t$tag" -Encoding UTF8
} catch { }

$tmpPath = "$statusPath.tmp"
$json = $status | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmpPath, $json, $utf8NoBom)
Move-Item -Path $tmpPath -Destination $statusPath -Force
