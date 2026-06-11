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

# Cheap liveness check: is the cached PID still a running terminal process?
# We deliberately do NOT compare against MainWindowHandle — Windows Terminal
# is one process owning many top-level windows (observed hwnds 200148 and
# 202290 under the same PID), and MainWindowHandle reports only whichever
# window is currently "main". Handle equality falsely invalidated good
# cached hwnds for sessions in background WT windows. A genuinely dead hwnd
# self-corrects: send-keys verifies focus landed before typing and fails
# clean, and the next UserPromptSubmit re-captures via foreground.
function Test-WindowStillValid {
    param($ProcessId, $Hwnd)
    if (-not $ProcessId -or -not $Hwnd) { return $false }
    try {
        $p = Get-Process -Id $ProcessId -ErrorAction Stop
        return $TERMINAL_NAMES -contains $p.ProcessName
    } catch { return $false }
}

# SessionStart and UserPromptSubmit force a fresh resolve: SessionStart
# covers /resume onto a new terminal; UserPromptSubmit is the one moment we
# *know* the user is typing in this session, so the foreground window is
# its terminal with near-certainty — the strongest capture signal we have.
# Every other event reuses the cached hwnd when it's still valid.
$resolveWindow = ($Event -eq 'SessionStart') -or ($Event -eq 'UserPromptSubmit') -or `
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

$resolveMethod = ''
if ($resolveWindow) {
    # Walking the parent chain doesn't work because Windows Terminal hosts
    # shells via ConPTY, breaking the Windows process-tree relationship — WT
    # isn't in the parent chain of its hosted shells. Capture order:
    #   1. foreground window, on SessionStart/UserPromptSubmit only (the user
    #      just typed here — works regardless of window titles)
    #   2. title contains this session's project name
    #   3. title contains 'Claude'
    #   4. exactly one terminal window on the desktop — it must be the host
    try {
        $terminals = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
            $_.MainWindowHandle -ne [IntPtr]::Zero -and
            $TERMINAL_NAMES -contains $_.ProcessName
        })
        $picked = $null
        if (($Event -eq 'SessionStart') -or ($Event -eq 'UserPromptSubmit')) {
            try {
                Add-Type -Namespace MxHook -Name Win32 -MemberDefinition `
                    '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();' -ErrorAction Stop
                $fg = [MxHook.Win32]::GetForegroundWindow()
                if ($fg -ne [IntPtr]::Zero) {
                    $picked = $terminals | Where-Object { [int64]$_.MainWindowHandle -eq [int64]$fg } | Select-Object -First 1
                    if ($picked) { $resolveMethod = 'FG' }
                }
            } catch { }
        }
        if (-not $picked -and $status.project) {
            $picked = $terminals | Where-Object { $_.MainWindowTitle -match [regex]::Escape($status.project) } | Select-Object -First 1
            if ($picked) { $resolveMethod = 'TITLE' }
        }
        if (-not $picked) {
            $picked = $terminals | Where-Object { $_.MainWindowTitle -match 'Claude' } | Select-Object -First 1
            if ($picked) { $resolveMethod = 'TITLE' }
        }
        if (-not $picked -and $terminals.Count -eq 1) {
            $picked = $terminals[0]
            $resolveMethod = 'ONLY'
        }
        if ($picked) {
            $status.claude_pid  = [int]$picked.Id
            $status.claude_hwnd = [int64]$picked.MainWindowHandle
        } elseif (-not (Test-WindowStillValid $status.claude_pid $status.claude_hwnd)) {
            # Nothing found AND the cache is dead — clear it. A still-valid
            # cached hwnd survives a missed resolve (e.g. the user submitted
            # from a minimized window, so foreground capture whiffed).
            $status.claude_pid  = $null
            $status.claude_hwnd = $null
        }
    } catch { }
}

# Diagnostic — CACHED means we skipped the expensive scan this fire.
try {
    $mode = if (-not $resolveWindow) { 'CACHED' }
            elseif ($resolveMethod)  { "RESOLVE-$resolveMethod" }
            else                     { 'RESOLVE-MISS' }
    $tag  = if ($status.claude_hwnd) { "$mode OK hwnd=$($status.claude_hwnd) pid=$($status.claude_pid)" } else { "$mode NOT-FOUND" }
    Add-Content -Path 'C:\Users\hdcooper\IB\projects\hardware-interface\logs\hooks-debug.log' `
                -Value "$(Get-Date -Format 'o')`tCAPTURE`t$tag" -Encoding UTF8
} catch { }

$tmpPath = "$statusPath.tmp"
$json = $status | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmpPath, $json, $utf8NoBom)
# Atomic swap. Move-Item -Force is delete-then-rename, which left an ENOENT
# window where the sidecar's fs.watch-triggered read found no file at all and
# dropped this session from the broadcast. File.Replace maps to ReplaceFile(),
# atomic on NTFS — readers see either the old or the new content, never nothing.
# Retry the atomic swap through transient lock contention (sidecar reads,
# concurrent hook fires) before surrendering to the non-atomic Move-Item —
# every fallback use reopens the ENOENT window the watcher then has to
# paper over with its missing-grace logic.
$swapped = $false
for ($i = 0; $i -lt 4 -and -not $swapped; $i++) {
    if ($i -gt 0) { Start-Sleep -Milliseconds 25 }
    try {
        if (Test-Path $statusPath) {
            [System.IO.File]::Replace($tmpPath, $statusPath, $null)
        } else {
            [System.IO.File]::Move($tmpPath, $statusPath)
        }
        $swapped = $true
    } catch { }
}
if (-not $swapped) {
    # Last resort (e.g. target vanished in a SessionEnd race).
    Move-Item -Path $tmpPath -Destination $statusPath -Force
}
