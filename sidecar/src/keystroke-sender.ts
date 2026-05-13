import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'send-keys.ps1')

export type KeystrokeCommand =
  | 'continue'   // sends 'continue⏎'
  | 'approve'    // sends 'y⏎'
  | 'reject'     // sends 'n⏎'
  | 'interrupt'  // sends Esc
  | 'resume'     // sends '/resume⏎'
  | 'focus'      // focuses target window, no keys

export class KeystrokeSender {
  send(command: KeystrokeCommand, claudePid: number | null): Promise<void> {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT,
      '-Command', command,
    ]
    if (claudePid) args.push('-ClaudePid', String(claudePid))

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
