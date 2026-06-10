// Diagnostic: connect to the sidecar WebSocket and append every broadcast
// to logs/ws-monitor.log, one line per message:
//   <iso-time>  <type>  <per-session summary: project:state[:notif]>
// This shows exactly what the keypad receives (and when), independent of
// the device — used to debug missing "thinking" transitions and Approve
// gating without staring at LCDs.
//
// Borrows the ws package from sidecar/node_modules (resolved explicitly —
// ESM import resolution is relative to this file, not the cwd):
//   node experiments/scripts/ws-monitor.mjs
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', '..', 'sidecar', 'package.json'))
const WebSocket = require('ws')
const LOG = join(here, '..', '..', 'logs', 'ws-monitor.log')
const URL = process.env.MX_SIDECAR_URL ?? 'ws://127.0.0.1:9876'

const log = (line) => {
  const stamped = `${new Date().toISOString()}\t${line}`
  console.log(stamped)
  try { appendFileSync(LOG, stamped + '\n') } catch {}
}

function connect() {
  const ws = new WebSocket(URL)
  ws.on('open', () => log('MONITOR-CONNECTED'))
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'sessions') {
        const summary = (msg.sessions ?? [])
          .map((s) => {
            const notif = s.notification_message ? `:${JSON.stringify(s.notification_message)}` : ''
            return `${s.project}:${s.state}${notif}`
          })
          .join('  |  ')
        log(`sessions\t${msg.sessions?.length ?? 0}\t${summary}`)
      } else {
        log(`${msg.type}\t${data.toString().slice(0, 300)}`)
      }
    } catch {
      log(`unparseable\t${data.toString().slice(0, 200)}`)
    }
  })
  ws.on('close', () => { log('MONITOR-DISCONNECTED — retrying in 2s'); setTimeout(connect, 2000) })
  ws.on('error', (err) => log(`MONITOR-ERROR\t${err.message}`))
}
connect()
