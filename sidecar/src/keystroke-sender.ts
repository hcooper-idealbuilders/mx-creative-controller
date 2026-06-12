import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'send-keys.ps1')

export type KeystrokeCommand =
  | 'approve'         // sends '1⏎'  (Claude Code's numbered "Yes")
  | 'focus'           // focuses target window, no keys
  | 'fast'            // sends '/fast⏎' (toggles Claude's fast mode)
  | 'effort-low'      // sends '/effort low⏎'
  | 'effort-medium'   // sends '/effort medium⏎'
  | 'effort-high'     // sends '/effort high⏎'
  | 'effort-xhigh'    // sends '/effort xhigh⏎'

export class KeystrokeSender {
  send(
    command: KeystrokeCommand,
    claudePid: number | null,
    claudeHwnd: number | null,
    projectHint?: string | null,
    tabTitle?: string | null,
    requireTabMatch = false,
  ): Promise<void> {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT,
      '-Command', command,
    ]
    if (claudeHwnd) args.push('-ClaudeHwnd', String(claudeHwnd))
    if (claudePid)  args.push('-ClaudePid',  String(claudePid))
    if (projectHint) args.push('-ProjectHint', projectHint)
    // Clamp: a corrupted (exponentially re-mojibake'd) tab title once blew
    // the spawn command-line limit (ENAMETOOLONG) and crash-looped the
    // sidecar. Titles are tens of chars; anything longer is garbage.
    if (tabTitle) args.push('-TabTitle', tabTitle.slice(0, 200))
    if (requireTabMatch) args.push('-RequireTabMatch')

    return new Promise((resolve, reject) => {
      // spawn can throw SYNCHRONOUSLY (e.g. ENAMETOOLONG) — without this
      // try/catch the throw escapes the async 'command' handler as an
      // unhandled rejection and kills the whole sidecar process.
      try {
        const proc = spawn('powershell', args, { windowsHide: true })
        let stderr = ''
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
        proc.on('exit', (code) => {
          if (code === 0) resolve()
          else reject(new Error(`send-keys exit ${code}: ${stderr}`))
        })
        proc.on('error', reject)
      } catch (err) {
        reject(err as Error)
      }
    })
  }
}
