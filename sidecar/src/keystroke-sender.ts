import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'send-keys.ps1')

export type Command = 'continue' | 'yes' | 'no' | 'interrupt' | 'focus'

export class KeystrokeSender {
  send(command: Command, claudePid: number | null): Promise<void> {
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
