# End-to-end test: drives the full pipeline (session file -> sidecar ->
# keystroke delivery) against a sandbox terminal window, so Approve/Focus/
# effort can be verified without touching real Claude Code sessions.
#
# Usage:  powershell -File experiments/scripts/e2e-test.ps1
# Writes: logs/e2e-results.log (PASS/FAIL per check), logs/sandbox-input.log
#
# Safe by construction: the fake session's claude_hwnd points at the sandbox
# window this script spawns, so every keystroke the sidecar sends lands in
# the sandbox logger, never in a real terminal.
$ErrorActionPreference = 'Stop'
$Root        = Split-Path (Split-Path $PSScriptRoot)
$SessionsDir = Join-Path $env:USERPROFILE '.claude\mx-sessions'
$SandboxLog  = Join-Path $Root 'logs\sandbox-input.log'
$ResultsLog  = Join-Path $Root 'logs\e2e-results.log'
$SessionId   = 'e2e00000-0000-0000-0000-000000000001'
$SessionPath = Join-Path $SessionsDir "$SessionId.json"

Remove-Item $SandboxLog, $ResultsLog -Force -ErrorAction SilentlyContinue
$results = New-Object System.Collections.Generic.List[string]
function Check([string]$name, [bool]$ok, [string]$detail = '') {
    $line = "{0}`t{1}`t{2}" -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $name, $detail
    $results.Add($line)
    Write-Host $line
}

# ---- 1. Spawn the sandbox: a visible PowerShell logging every input line ----
# Spawned via WScript.Shell (the same trick the launchers use): Start-Process
# from a hidden console inherits the windowless console, so the child never
# gets a MainWindowHandle. WshShell.Run(windowStyle=1) forces a real window.
$loggerScript = Join-Path $env:TEMP 'mx-sandbox-logger.ps1'
@"
`$host.UI.RawUI.WindowTitle = 'MX-SANDBOX'
while (`$true) {
    `$l = Read-Host
    Add-Content -LiteralPath '$SandboxLog' -Value `$l
}
"@ | Set-Content -LiteralPath $loggerScript -Encoding UTF8
# conhost.exe prefix: with Windows Terminal as the default terminal app, a
# bare powershell.exe would open as a WT *tab* and never own a window handle.
# conhost forces a classic console window we can target.
$wsh = New-Object -ComObject WScript.Shell
$null = $wsh.Run("conhost.exe powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$loggerScript`"", 1, $false)
# Find it by window title; MainWindowHandle populates late — poll up to 15s.
$sandbox = $null
$hwnd = [int64]0
for ($i = 0; $i -lt 30 -and $hwnd -eq 0; $i++) {
    Start-Sleep -Milliseconds 500
    $sandbox = Get-Process powershell, conhost -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -eq 'MX-SANDBOX' } | Select-Object -First 1
    if ($sandbox) { $hwnd = [int64]$sandbox.MainWindowHandle }
}
Check 'sandbox window spawned' ($hwnd -ne 0) "pid=$($sandbox.Id) hwnd=$hwnd"
if ($hwnd -eq 0) { $results | Set-Content $ResultsLog; exit 1 }

try {
    # ---- 2. Fake session file: waiting_input + permission prompt ----
    $now = (Get-Date).ToUniversalTime().ToString('o')
    $session = [ordered]@{
        state                = 'waiting_input'
        project              = 'e2e-sandbox'
        model                = 'test'
        fast_mode            = $false
        session_id           = $SessionId
        claude_pid           = [int]$sandbox.Id
        claude_hwnd          = $hwnd
        first_seen           = $now
        last_event           = 'Notification'
        last_updated         = $now
        notification_message = 'Claude needs your permission'
        claude_code_pid      = [int]$sandbox.Id
    }
    $session | ConvertTo-Json | Set-Content -LiteralPath $SessionPath -Encoding UTF8
    Start-Sleep -Seconds 2   # let the watcher pick it up + broadcast

    # ---- 3. Drive commands through the sidecar WS as a fake keypad ----
    $nodeClient = @'
const { createRequire } = require('node:module')
const req = createRequire(process.argv[2] + '/package.json')
const WebSocket = req('ws')
const sessionId = process.argv[3]
const timeoutMs = Number(process.argv[4])
const commands = process.argv.slice(5)
const ws = new WebSocket('ws://127.0.0.1:9876')
const results = []
let idx = 0
ws.on('open', () => send())
function send() {
  if (idx >= commands.length) { console.log(JSON.stringify(results)); process.exit(0) }
  ws.send(JSON.stringify({ type: 'command', sessionId, command: commands[idx] }))
}
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.type === 'command-result' && msg.sessionId === sessionId) {
    results.push({ command: commands[idx], success: msg.success, error: msg.error ?? null })
    idx++
    setTimeout(send, 1500)   // settle between keystroke sends
  }
})
setTimeout(() => { console.log(JSON.stringify(results)); process.exit(1) }, timeoutMs)
'@
    $clientPath = Join-Path $env:TEMP 'mx-e2e-client.cjs'
    Set-Content -LiteralPath $clientPath -Value $nodeClient -Encoding UTF8
    $sidecarDir = Join-Path $Root 'sidecar'
    $cmdOut = node $clientPath $sidecarDir $SessionId 60000 'continue' 'effort-low' 'focus' | Select-Object -Last 1
    $cmdResults = $cmdOut | ConvertFrom-Json
    Check 'approve command accepted' ($cmdResults[0].success -eq $true) ("$($cmdResults[0].error)")
    Check 'effort command accepted'  ($cmdResults[1].success -eq $true) ("$($cmdResults[1].error)")
    Check 'focus command accepted'   ($cmdResults[2].success -eq $true) ("$($cmdResults[2].error)")

    Start-Sleep -Seconds 2

    # ---- 4. Verify keystrokes landed in the sandbox ----
    $received = @(Get-Content $SandboxLog -ErrorAction SilentlyContinue)
    Check 'approve keystroke (1) received'          ($received -contains '1') "got: $($received -join ' | ')"
    Check 'effort keystroke (/effort low) received' (($received | Where-Object { $_ -match '/effort low' }).Count -ge 1) ''

    # ---- 5. Verify markApproved held the state ----
    $after = Get-Content $SessionPath -Raw | ConvertFrom-Json
    Check 'state flipped to thinking after approve' ($after.state -eq 'thinking') "state=$($after.state)"
    Check 'notification cleared after approve'      (-not $after.notification_message) ''

    # ---- 6. Verify focus left the sandbox foreground ----
    Add-Type -Namespace E2E -Name Win32 -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();'
    $fg = [int64][E2E.Win32]::GetForegroundWindow()
    Check 'focus left sandbox in foreground' ($fg -eq $hwnd) "fg=$fg expected=$hwnd"

    # ---- 7. Double-press guard: approve again while thinking must be refused ----
    $before = @(Get-Content $SandboxLog -ErrorAction SilentlyContinue).Count
    $null = node $clientPath $sidecarDir $SessionId 6000 'continue' 2>$null
    Start-Sleep -Seconds 2
    $afterCount = @(Get-Content $SandboxLog -ErrorAction SilentlyContinue).Count
    Check 'second approve while thinking is ignored' ($afterCount -eq $before) "lines before=$before after=$afterCount"
}
finally {
    # ---- Cleanup: remove fake session, kill sandbox ----
    Remove-Item $SessionPath -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $sandbox.Id -Force -ErrorAction SilentlyContinue
    $results | Set-Content $ResultsLog
}

$failed = @($results | Where-Object { $_ -like 'FAIL*' }).Count
Write-Host "`n$($results.Count) checks, $failed failed"
exit $failed
