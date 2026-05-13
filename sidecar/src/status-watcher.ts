import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { existsSync, watch as fsWatch } from 'node:fs'

export interface Status {
  state: 'idle' | 'thinking' | 'done' | 'waiting_input'
  project: string | null
  model: string | null
  fast_mode: boolean
  session_id: string | null
  claude_pid: number | null
  last_event: string | null
  last_updated: string | null
}

export class StatusWatcher extends EventEmitter {
  current: Status | null = null

  constructor(private path: string) {
    super()
  }

  async start(): Promise<void> {
    await this.read()
    this.attach()
  }

  private async read(): Promise<void> {
    if (!existsSync(this.path)) return
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (err) {
      console.error('[status-watcher] read failed:', (err as Error).message)
      return
    }
    // Strip UTF-8 BOM if present — PowerShell sometimes writes one.
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    try {
      this.current = JSON.parse(raw) as Status
      this.emit('change', this.current)
    } catch (err) {
      console.error('[status-watcher] parse failed:', (err as Error).message)
    }
  }

  private attach(): void {
    const tryWatch = (): void => {
      if (!existsSync(this.path)) {
        setTimeout(tryWatch, 1000)
        return
      }
      const w = fsWatch(this.path, () => {
        void this.read()
      })
      w.on('error', () => {
        w.close()
        setTimeout(tryWatch, 1000)
      })
    }
    tryWatch()
  }
}
