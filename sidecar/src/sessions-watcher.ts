import { EventEmitter } from 'node:events'
import { readdir, readFile, unlink, mkdir } from 'node:fs/promises'
import { watch as fsWatch, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionState, SessionStatus } from '../../shared/types'

export type { SessionState, SessionStatus }

/**
 * Sessions whose last_updated is older than this are considered abandoned
 * (Claude Code crashed or the user closed the terminal without firing
 * SessionEnd). The watcher deletes them on reload so old runs don't
 * accumulate and crowd live sessions out of the keypad's 3 visible slots.
 */
export const SESSION_STALE_MS = 2 * 60 * 60 * 1000 // 2 hours

/** Pure predicate so we can test the prune behavior without touching disk. */
export function isStale(lastUpdated: string | null, now: number, thresholdMs = SESSION_STALE_MS): boolean {
  if (!lastUpdated) return false
  const t = Date.parse(lastUpdated)
  if (Number.isNaN(t)) return false
  return now - t > thresholdMs
}

/** True if the given PID still corresponds to a running process. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)  // signal 0 = existence check, doesn't kill
    return true
  } catch {
    return false
  }
}

/**
 * How often the watcher force-reloads even without an fsWatch trigger.
 * Catches dead PIDs that no hook event will ever clean up (user killed
 * the terminal window → SessionEnd never fires, directory unchanged).
 */
const LIVENESS_POLL_MS = 30_000

export class SessionsWatcher extends EventEmitter {
  sessions: SessionStatus[] = []

  constructor(private dir: string) { super() }

  async start(): Promise<void> {
    if (!existsSync(this.dir)) {
      await mkdir(this.dir, { recursive: true }).catch(() => {})
    }
    await this.reload()
    this.attach()
    setInterval(() => { void this.reload() }, LIVENESS_POLL_MS)
  }

  /** Sessions in FIFO order by first_seen. Column N == sessions[N]. */
  private async reload(): Promise<void> {
    const out: SessionStatus[] = []
    const now = Date.now()
    try {
      const files = await readdir(this.dir)
      for (const f of files) {
        if (!f.endsWith('.json') || f.endsWith('.tmp')) continue
        const path = join(this.dir, f)
        let parsed: SessionStatus | null = null
        try {
          let raw = await readFile(path, 'utf8')
          if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
          parsed = JSON.parse(raw) as SessionStatus
        } catch (err) {
          console.error(`[sessions-watcher] parse failed for ${f}:`, (err as Error).message)
          continue
        }
        // Drop sessions whose Claude Code process is no longer running.
        // Prefer claude_code_pid (the node.exe that IS Claude Code) over
        // claude_pid (the terminal host, e.g. WindowsTerminal.exe) because
        // multi-tab terminals outlive individual sessions.
        const livenessPid = parsed.claude_code_pid ?? parsed.claude_pid
        if (livenessPid && !isPidAlive(livenessPid)) {
          await unlink(path).catch(() => {})
          console.log(`[sessions-watcher] pruned ${f} (PID ${livenessPid} dead)`)
          continue
        }
        // Fallback: if neither PID is available, use the 2-hour timestamp check.
        if (isStale(parsed.last_updated, now)) {
          await unlink(path).catch(() => {})
          console.log(`[sessions-watcher] pruned stale ${f} (last_updated ${parsed.last_updated})`)
          continue
        }
        out.push(parsed)
      }
    } catch (err) {
      console.error('[sessions-watcher] readdir failed:', (err as Error).message)
    }
    out.sort((a, b) => (a.first_seen ?? '').localeCompare(b.first_seen ?? ''))
    this.sessions = out
    this.emit('change', this.sessions)
  }

  private attach(): void {
    const tryWatch = (): void => {
      if (!existsSync(this.dir)) {
        setTimeout(tryWatch, 1000)
        return
      }
      const w = fsWatch(this.dir, () => { void this.reload() })
      w.on('error', () => { w.close(); setTimeout(tryWatch, 1000) })
    }
    tryWatch()
  }

  getByColumn(column: number): SessionStatus | null {
    return this.sessions[column] ?? null
  }

  getBySessionId(id: string): SessionStatus | null {
    return this.sessions.find((s) => s.session_id === id) ?? null
  }
}
