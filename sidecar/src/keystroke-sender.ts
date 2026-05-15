import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'send-keys.ps1')

export type KeystrokeCommand =
  | 'approve'         // sends 'y⏎'
  | 'focus'           // focuses target window, no keys
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

    return new Promise((resolve, reject) => {
      const proc = spawn('powershell', args, { windowsHide: true })
      let stderr = ''
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      proc.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`send-keys exit ${code}: ${stderr}`))
      })
      proc.on('error', reject)
    })
  }
}
