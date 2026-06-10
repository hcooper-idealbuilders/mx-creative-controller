import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionsWatcher } from './sessions-watcher.js'
import { IpcServer, type CommandMessage } from './ipc-server.js'
import { KeystrokeSender } from './keystroke-sender.js'
import { routeCommand } from './routing.js'

const SESSIONS_DIR =
  process.env.MX_SESSIONS_DIR ??
  `${process.env.USERPROFILE}\\.claude\\mx-sessions`
const PORT = Number(process.env.MX_SIDECAR_PORT ?? 9876)

/**
 * After a delivered approve, no hook fires in that session until the
 * approved tool *finishes* (PreToolUse already ran before the permission
 * prompt). The session file would keep saying waiting_input + "needs your
 * permission" for minutes, re-lighting Approve while Claude is actually
 * working. Write the truth we know into the file: it's thinking now.
 * The next real hook event overwrites this regardless.
 */
async function markApproved(sessionId: string): Promise<void> {
  const path = join(SESSIONS_DIR, `${sessionId}.json`)
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  let lastErr: Error | null = null
  // Retry the whole read-modify-swap: the hook's own ReplaceFile can hold
  // the target at the exact moment we rename (observed as EPERM), and losing
  // this write re-lights Approve — which invites a double-press that types a
  // stray "1⏎" into the session. Worth being stubborn about.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(30)
    try {
      let raw = await readFile(path, 'utf8')
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
      const s = JSON.parse(raw) as Record<string, unknown>
      if (s.state !== 'waiting_input') return  // a real hook event beat us — its truth wins
      s.state = 'thinking'
      s.notification_message = null
      s.last_event = 'KeypadApprove'
      s.last_updated = new Date().toISOString()
      const json = JSON.stringify(s, null, 2)
      const tmp = `${path}.tmp`
      try {
        await writeFile(tmp, json)
        await rename(tmp, path)  // atomic on same volume; watcher ignores *.tmp
      } catch (swapErr) {
        // Rename blocked (EPERM lock contention): write in place. Non-atomic,
        // but the watcher retries partial/failed reads, and a hook overwrite
        // a moment later is fine — hooks are the source of truth anyway.
        await unlink(tmp).catch(() => {})
        await writeFile(path, json)
      }
      return
    } catch (err) {
      lastErr = err as Error
    }
  }
  console.error('[mx-sidecar] markApproved failed after retries:', lastErr?.message)
}

const watcher = new SessionsWatcher(SESSIONS_DIR)
const sender  = new KeystrokeSender()
const server  = new IpcServer(PORT)

const broadcastSessions = () => {
  server.broadcast({ type: 'sessions', sessions: watcher.sessions })
}

watcher.on('change', () => broadcastSessions())

server.on('connect', (sendOne) => {
  sendOne({ type: 'sessions', sessions: watcher.sessions })
})

server.on('command', async (cmd: CommandMessage) => {
  const session = watcher.getBySessionId(cmd.sessionId)
  if (!session) {
    console.error(`[mx-sidecar] command for unknown session ${cmd.sessionId}: ${cmd.command}`)
    return
  }
  const result = routeCommand(cmd.command, session.state)
  if (result.kind === 'unknown') {
    console.error(`[mx-sidecar] unknown command: ${cmd.command} in state ${session.state}`)
    return
  }
  console.log(`[mx-sidecar] ${cmd.sessionId.slice(0, 8)}… state=${session.state} → ${result.keystroke}`)
  try {
    await sender.send(result.keystroke, session.claude_pid, session.claude_hwnd, session.project)
    if (result.keystroke === 'approve') {
      await markApproved(cmd.sessionId)  // triggers a fresh broadcast via fsWatch
    }
    server.broadcast({
      type: 'command-result',
      sessionId: cmd.sessionId, command: cmd.command, success: true,
    })
  } catch (err) {
    console.error('[mx-sidecar] send failed:', err)
    server.broadcast({
      type: 'command-result',
      sessionId: cmd.sessionId, command: cmd.command, success: false,
      error: (err as Error).message,
    })
  }
})

await watcher.start()
server.start()
console.log(`[mx-sidecar] watching ${SESSIONS_DIR}`)
console.log(`[mx-sidecar] ws://127.0.0.1:${PORT}`)
