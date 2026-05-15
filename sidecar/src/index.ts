import { SessionsWatcher } from './sessions-watcher.js'
import { IpcServer, type CommandMessage } from './ipc-server.js'
import { KeystrokeSender } from './keystroke-sender.js'
import { routeCommand } from './routing.js'

const SESSIONS_DIR =
  process.env.MX_SESSIONS_DIR ??
  `${process.env.USERPROFILE}\\.claude\\mx-sessions`
const PORT = Number(process.env.MX_SIDECAR_PORT ?? 9876)

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
