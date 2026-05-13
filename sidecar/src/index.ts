import { StatusWatcher } from './status-watcher.js'
import { IpcServer } from './ipc-server.js'
import { KeystrokeSender, type Command } from './keystroke-sender.js'

const STATUS_PATH =
  process.env.MX_STATUS_PATH ??
  `${process.env.USERPROFILE}\\.claude\\mx-console-status.json`
const PORT = Number(process.env.MX_SIDECAR_PORT ?? 9876)

const watcher = new StatusWatcher(STATUS_PATH)
const sender = new KeystrokeSender()
const server = new IpcServer(PORT)

watcher.on('change', (status) => {
  server.broadcast({ type: 'status', status })
})

server.on('connect', (sendOne) => {
  if (watcher.current) sendOne({ type: 'status', status: watcher.current })
})

server.on('command', async (command: Command) => {
  const status = watcher.current
  try {
    await sender.send(command, status?.claude_pid ?? null)
  } catch (err) {
    console.error('[mx-sidecar] send failed:', err)
  }
})

void watcher.start()
server.start()

console.log(`[mx-sidecar] watching ${STATUS_PATH}`)
console.log(`[mx-sidecar] ws://127.0.0.1:${PORT}`)
