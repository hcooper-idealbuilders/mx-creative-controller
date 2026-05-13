param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('SessionStart','UserPromptSubmit','Stop','Notification','SessionEnd')]
    [string]$Event
)

$ErrorActionPreference = 'Stop'

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
$status = if (Test-Path $statusPath) {
    Get-Content $statusPath -Raw | ConvertFrom-Json
} else {
    [pscustomobject]@{
        state         = 'idle'
        project       = $null
        model         = $null
        fast_mode     = $false
        session_id    = $sessionId
        claude_pid    = $null
        first_seen    = (Get-Date).ToUniversalTime().ToString('o')
        last_event    = $null
        last_updated  = $null
    }
}

$status.state = switch ($Event) {
    'SessionStart'     { 'idle' }
    'UserPromptSubmit' { 'thinking' }
    'Stop'             { 'done' }
    'Notification'     { 'waiting_input' }
    'SessionEnd'       { 'ended' }
}
$status.last_event   = $Event
$status.last_updated = (Get-Date).ToUniversalTime().ToString('o')

if ($payload.cwd)   { $status.project = Split-Path $payload.cwd -Leaf }
if ($payload.model) {
    $status.model = if ($payload.model.id) { $payload.model.id } else { [string]$payload.model }
}

# Walk up the process tree until we find a *terminal* ancestor (one of
# powershell / pwsh / WindowsTerminal / conhost / cmd) that owns a window —
# that's the host running Claude Code. Done on every event so a missed
# SessionStart still gets corrected on the next hook fire.
#
# We exclude generic window-owners like explorer.exe because every desktop
# process eventually descends from explorer; accepting the first window
# ancestor would mis-capture it as the "Claude" PID.
$TERMINAL_NAMES = @('powershell','pwsh','WindowsTerminal','conhost','cmd','windowsterminalpreview')
try {
    $walk = $PID
    for ($i = 0; $i -lt 8 -and $walk -gt 0; $i++) {
        $walk = (Get-CimInstance Win32_Process -Filter "ProcessId=$walk" -ErrorAction SilentlyContinue).ParentProcessId
        if (-not $walk) { break }
        $cand = Get-Process -Id $walk -ErrorAction SilentlyContinue
        if ($cand -and
            $cand.MainWindowHandle -ne [IntPtr]::Zero -and
            $TERMINAL_NAMES -contains $cand.ProcessName) {
            $status.claude_pid = [int]$walk
            break
        }
    }
} catch { }

$tmpPath = "$statusPath.tmp"
$json = $status | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmpPath, $json, $utf8NoBom)
Move-Item -Path $tmpPath -Destination $statusPath -Force
