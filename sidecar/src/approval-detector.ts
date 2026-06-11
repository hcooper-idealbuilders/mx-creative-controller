// Detects KEYBOARD approvals of permission prompts.
//
// Claude Code has no hook that fires when the user approves a permission
// prompt at the terminal (verified against the hooks docs, June 2026):
// PreToolUse fires before the prompt, then nothing until PostToolUse when
// the tool *finishes* — minutes later for a long Bash command. Keypad
// approvals are covered (the sidecar writes state=thinking after sending
// the keystroke), but a keyboard approval leaves the session file stuck at
// waiting_input: the console shows orange + a lit Approve key for a session
// that is actually running, and a press would type a stray "1" into it.
//
// So we detect approval by its physical side effect: the moment the user
// approves, Claude Code spawns the tool's child process (pwsh/bash/cmd/...).
// While a session sits on a *permission* prompt, poll for children of
// claude_code_pid created after the prompt appeared — one shows up means
// the user approved.
//
// Scope notes:
// - Only sessions whose notification_message looks like a permission prompt
//   are polled ("waiting for your input" free-text waits spawn nothing).
// - In-process tools (Edit/Read/Write) spawn no child, but they complete in
//   milliseconds, so PostToolUse corrects the state immediately anyway. The
//   stale-for-minutes window comes precisely from the process-spawning tools.
// - powershell.exe children are ignored: our own hooks run as
//   powershell.exe children of claude.exe and would false-positive.
import { execFile } from 'node:child_process'

export interface ChildProcessInfo {
  pid: number
  name: string
  /** Creation time, epoch ms. */
  created: number
}

/**
 * Pure decision: did any child created after the prompt appeared indicate an
 * approval? `promptShownAt` is the session's last_updated at the
 * waiting_input transition. The 1s margin absorbs clock skew between the
 * hook's timestamp and process creation times.
 */
export function indicatesApproval(
  children: ChildProcessInfo[],
  promptShownAtMs: number,
  marginMs = 1000,
): boolean {
  return children.some(
    (c) => c.name.toLowerCase() !== 'powershell.exe' && c.created > promptShownAtMs + marginMs,
  )
}

/** List direct children of a PID via CIM. Returns [] on any failure. */
export function listChildren(parentPid: number): Promise<ChildProcessInfo[]> {
  const ps =
    `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${parentPid}' | ` +
    `Select-Object ProcessId,Name,@{N='Created';E={[long]($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds}} | ` +
    `ConvertTo-Json -Compress`
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 10_000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve([])
        try {
          const parsed = JSON.parse(stdout)
          const rows = Array.isArray(parsed) ? parsed : [parsed]
          resolve(
            rows
              .filter((r) => r && typeof r.ProcessId === 'number')
              .map((r) => ({ pid: r.ProcessId, name: String(r.Name ?? ''), created: Number(r.Created ?? 0) })),
          )
        } catch {
          resolve([])
        }
      },
    )
  })
}
