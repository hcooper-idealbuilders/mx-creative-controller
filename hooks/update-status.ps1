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

if ($Event -eq 'SessionStart') {
    # Walk parent-of-parent to capture the Claude process PID
    # (the hook script's parent is the shell Claude Code spawned for us).
    try {
        $shell = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
        $claude = (Get-CimInstance Win32_Process -Filter "ProcessId=$shell").ParentProcessId
        if ($claude) { $status.claude_pid = [int]$claude }
    } catch { }
}

$tmpPath = "$statusPath.tmp"
$json = $status | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmpPath, $json, $utf8NoBom)
Move-Item -Path $tmpPath -Destination $statusPath -Force
