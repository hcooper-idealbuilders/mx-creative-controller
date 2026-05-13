param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('SessionStart','UserPromptSubmit','Stop','Notification')]
    [string]$Event
)

$ErrorActionPreference = 'Stop'

$hookJson = [Console]::In.ReadToEnd()
$payload = if ($hookJson) {
    try { $hookJson | ConvertFrom-Json } catch { $null }
} else { $null }

$statusPath = Join-Path $env:USERPROFILE '.claude\mx-console-status.json'

$status = if (Test-Path $statusPath) {
    Get-Content $statusPath -Raw | ConvertFrom-Json
} else {
    [pscustomobject]@{
        state         = 'idle'
        project       = $null
        model         = $null
        fast_mode     = $false
        session_id    = $null
        claude_pid    = $null
        last_event    = $null
        last_updated  = $null
    }
}

$status.state = switch ($Event) {
    'SessionStart'     { 'idle' }
    'UserPromptSubmit' { 'thinking' }
    'Stop'             { 'done' }
    'Notification'     { 'waiting_input' }
}
$status.last_event   = $Event
$status.last_updated = (Get-Date).ToUniversalTime().ToString('o')

if ($payload) {
    if ($payload.session_id)     { $status.session_id = $payload.session_id }
    if ($payload.cwd)            { $status.project    = Split-Path $payload.cwd -Leaf }
    if ($payload.model)          {
        $status.model = if ($payload.model.id) { $payload.model.id } else { [string]$payload.model }
    }
}

if ($Event -eq 'SessionStart') {
    # The hook script's parent is typically the shell Claude spawned the hook in;
    # its parent is Claude Code. Walk two levels up. Best-effort — sidecar falls
    # back to foreground-window targeting if this is wrong.
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
