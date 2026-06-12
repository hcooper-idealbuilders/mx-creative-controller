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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * How long a previously-seen session survives being absent from a directory
 * read before the watcher drops it. Covers the hook's non-atomic fallback
 * write path (delete+rename), where the file genuinely vanishes for a few
 * ms — without grace, the session flickers out of one broadcast, the keypad
 * repaints columns, and the remap lockout fires for nothing.
 */
export const MISSING_GRACE_MS = 800

export class SessionsWatcher extends EventEmitter {
  sessions: SessionStatus[] = []
  private reloading = false
  private reloadQueued = false
  private stopped = false
  private pollTimer: NodeJS.Timeout | null = null
  private fsWatcher: ReturnType<typeof fsWatch> | null = null
  /** Last known status per session id + when it first went missing from disk. */
  private lastKnown = new Map<string, { status: SessionStatus; missingSince: number | null }>()

  constructor(private dir: string) { super() }

  async start(): Promise<void> {
    if (!existsSync(this.dir)) {
      await mkdir(this.dir, { recursive: true }).catch(() => {})
    }
    await this.reload()
    this.attach()
    // unref: the poll must not be what keeps the process alive — the WS
    // server owns that.
    this.pollTimer = setInterval(() => { void this.reload() }, LIVENESS_POLL_MS)
    this.pollTimer.unref()
  }

  /**
   * Tear down the fs watcher and liveness poll. Without this, tests that
   * rm -rf the watched directory in afterEach trigger straggler reloads
   * whose console output races vitest's worker teardown and hangs it.
   */
  stop(): void {
    this.stopped = true
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    if (this.fsWatcher) { this.fsWatcher.close(); this.fsWatcher = null }
  }

  /**
   * Serialized + coalesced entry point. fsWatch can fire several times per
   * hook write; running reloads concurrently let a slow stale read finish
   * *after* a fresh one and clobber it (last emit wins). Instead: one reload
   * at a time, and any trigger that arrives mid-run queues exactly one
   * follow-up pass.
   */
  private async reload(): Promise<void> {
    if (this.stopped) return
    if (this.reloading) { this.reloadQueued = true; return }
    this.reloading = true
    try {
      do {
        this.reloadQueued = false
        await this.doReload()
      } while (this.reloadQueued && !this.stopped)
    } finally {
      this.reloading = false
    }
  }

  /** Sessions in FIFO order by first_seen. Column N == sessions[N]. */
  private async doReload(): Promise<void> {
    const out: SessionStatus[] = []
    const now = Date.now()
    try {
      const files = await readdir(this.dir)
      for (const f of files) {
        if (!f.endsWith('.json') || f.endsWith('.tmp')) continue
        const path = join(this.dir, f)
        // Brief retry on read/parse failure: a failure here is usually the
        // hook mid-swap (or mid-write on non-atomic fallback), and dropping
        // the session from this broadcast makes the keypad column flicker
        // or miss a state transition entirely.
        let parsed: SessionStatus | null = null
        let lastErr: Error | null = null
        for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
          if (attempt > 0) await sleep(25)
          try {
            let raw = await readFile(path, 'utf8')
            if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
            parsed = JSON.parse(raw) as SessionStatus
          } catch (err) {
            lastErr = err as Error
          }
        }
        if (!parsed) {
          console.error(`[sessions-watcher] parse failed for ${f}:`, lastErr?.message)
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
        // Fallback ONLY when no PID is available: a live session can sit
        // idle past any timestamp threshold (overnight terminal left open)
        // and must not be evicted — this wrongly pruned a healthy session
        // that had simply been quiet since 3am.
        if (!livenessPid && isStale(parsed.last_updated, now)) {
          await unlink(path).catch(() => {})
          console.log(`[sessions-watcher] pruned stale ${f} (last_updated ${parsed.last_updated})`)
          continue
        }
        out.push(parsed)
      }
    } catch (err) {
      console.error('[sessions-watcher] readdir failed:', (err as Error).message)
    }

    // Missing-grace: keep recently-vanished sessions alive briefly, then
    // schedule a confirming reload. Genuine SessionEnd deletions still
    // disappear — just up to ~MISSING_GRACE_MS later.
    const onDisk = new Set(out.map((s) => s.session_id))
    for (const [id, entry] of this.lastKnown) {
      if (onDisk.has(id)) continue
      if (entry.missingSince === null) entry.missingSince = now
      if (now - entry.missingSince < MISSING_GRACE_MS) {
        out.push(entry.status)
        setTimeout(() => { void this.reload() }, MISSING_GRACE_MS / 2).unref()
      } else {
        this.lastKnown.delete(id)
      }
    }
    const newKnown = new Map<string, { status: SessionStatus; missingSince: number | null }>()
    for (const s of out) {
      const prev = this.lastKnown.get(s.session_id)
      newKnown.set(s.session_id, {
        status: s,
        missingSince: onDisk.has(s.session_id) ? null : (prev?.missingSince ?? now),
      })
    }
    this.lastKnown = newKnown

    out.sort((a, b) => (a.first_seen ?? '').localeCompare(b.first_seen ?? ''))
    this.sessions = out
    this.emit('change', this.sessions)
  }

  private attach(): void {
    const tryWatch = (): void => {
      if (this.stopped) return
      if (!existsSync(this.dir)) {
        setTimeout(tryWatch, 1000).unref()
        return
      }
      const w = fsWatch(this.dir, () => { void this.reload() })
      w.unref()  // same as the liveness poll — don't hold the event loop open
      w.on('error', () => { w.close(); setTimeout(tryWatch, 1000).unref() })
      this.fsWatcher = w
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
