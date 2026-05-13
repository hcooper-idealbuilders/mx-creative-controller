#!/usr/bin/env node
import WebSocket from 'ws'
import readline from 'node:readline'

const PORT = Number(process.env.MX_SIDECAR_PORT ?? 9876)
const URL = `ws://127.0.0.1:${PORT}`
const LIVE = process.argv.includes('--live')

const STATE_COLOR = {
  idle:          '\x1b[90m',
  thinking:      '\x1b[33m',
  done:          '\x1b[32m',
  waiting_input: '\x1b[31m',
}
const RESET = '\x1b[0m'

const ws = new WebSocket(URL)

ws.on('open', () => {
  console.log(`[smoke] connected ${URL}${LIVE ? '  (LIVE — keys send real keystrokes)' : '  (dry-run — pass --live to actually send)'}`)
  console.log('[smoke] keys: c=continue  y=yes  n=no  i=interrupt  f=focus  q=quit')
})

ws.on('message', (data) => {
  let msg
  try { msg = JSON.parse(data.toString()) } catch { return }
  if (msg.type !== 'status') { console.log('[smoke] <-', msg); return }
  const s = msg.status
  const dot = STATE_COLOR[s.state] ?? ''
  console.log(
    `${dot}● ${s.state.padEnd(13)}${RESET}` +
    ` project=${s.project ?? '?'}` +
    `  model=${s.model ?? '?'}` +
    `  event=${s.last_event ?? '?'}` +
    `  pid=${s.claude_pid ?? 'null'}`
  )
})

ws.on('close', () => { console.log('[smoke] disconnected'); process.exit(0) })
ws.on('error', (err) => console.error('[smoke] error:', err.message))

const KEY_MAP = { c: 'continue', y: 'yes', n: 'no', i: 'interrupt', f: 'focus' }

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const key = line.trim().toLowerCase()
  if (key === 'q') { ws.close(); return }
  const command = KEY_MAP[key]
  if (!command) { console.log(`[smoke] unknown: ${key}`); return }
  if (!LIVE) { console.log(`[smoke] (dry-run) would send: ${command}`); return }
  ws.send(JSON.stringify({ type: 'command', command }))
  console.log(`[smoke] -> ${command}`)
})
