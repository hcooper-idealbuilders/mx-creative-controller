import { SessionsWatcher } from './sessions-watcher.js'
import { IpcServer, type CommandMessage } from './ipc-server.js'
import { KeystrokeSender, type KeystrokeCommand } from './keystroke-sender.js'

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

  // Dismiss: just delete the session file. No keystrokes.
  if (cmd.command === 'dismiss') {
    console.log(`[mx-sidecar] dismiss session ${cmd.sessionId}`)
    await watcher.dismiss(cmd.sessionId)
    return
  }

  // Map keypad command to keystroke command. "continue" is smart:
  // on waiting_input it sends `y⏎`, otherwise plain `continue⏎`.
  let keystroke: KeystrokeCommand | null = null
  switch (cmd.command) {
    case 'continue':
      keystroke = session.state === 'waiting_input' ? 'approve' : 'continue'
      break
    case 'resume':
      keystroke = 'resume'
      break
    case 'focus':
      keystroke = 'focus'
      break
    default:
      console.error(`[mx-sidecar] unknown command: ${cmd.command}`)
      return
  }
  console.log(`[mx-sidecar] ${cmd.sessionId.slice(0, 8)}… state=${session.state} → ${keystroke}`)
  try {
    await sender.send(keystroke, session.claude_pid)
  } catch (err) {
    console.error('[mx-sidecar] send failed:', err)
  }
})

await watcher.start()
server.start()
console.log(`[mx-sidecar] watching ${SESSIONS_DIR}`)
console.log(`[mx-sidecar] ws://127.0.0.1:${PORT}`)
