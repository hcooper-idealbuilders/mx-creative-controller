// Multi-session keypad controller.
//
// Layout (3 cols × 3 rows; sessions are FIFO):
//   row 0 — Claude mark per session, tinted by state
//   row 1 — primary action  (Continue / Approve / Resume per state)
//   row 2 — secondary action (Focus / Dismiss per state)
import { MxKeypad, type PressEvent } from './device.js'
import { SidecarClient } from './sidecar-client.js'
import { renderLayout, needsAnimation } from './renderer.js'
import { applyOptimisticUpdate } from './optimistic.js'
import type { Command, SessionStatus } from './state.js'

const SIDECAR_URL = process.env.MX_SIDECAR_URL ?? 'ws://127.0.0.1:9876'
const IDLE_REFRESH_MS = Number(process.env.MX_REFRESH_MS ?? 1000)
const ANIM_REFRESH_MS = Number(process.env.MX_ANIM_MS ?? 200)

const keypad = new MxKeypad()
await keypad.open()
console.log('[keypad] device open')

let currentSessions: SessionStatus[] = []
let painting = false

async function repaint() {
  if (painting) return
  painting = true
  try {
    const rgbas = renderLayout(currentSessions)
    for (let i = 0; i < rgbas.length; i++) {
      try {
        await keypad.paintKey(i, rgbas[i])
      } catch (err) {
        console.error(`[keypad] paint key ${i} failed:`, err)
      }
    }
  } finally {
    painting = false
  }
}

// Initial blank paint.
await repaint()

const sidecar = new SidecarClient(SIDECAR_URL)
sidecar.on('sessions', (sessions: SessionStatus[]) => {
  // Cap at 3 visible (FIFO).
  currentSessions = sessions.slice(0, 3)
  void repaint()
})
sidecar.on('close', () => {
  currentSessions = []
  void repaint()
})
sidecar.connect()

// Press dispatcher — map key index → (column, row) → command + session.
keypad.on('press', (evt: PressEvent) => {
  if (evt.kind !== 'down') return
  const idx = evt.control.index
  if (idx < 0 || idx > 8) return // ignore the row-3 hardware buttons for now
  const col = idx % 3
  const row = Math.floor(idx / 3)
  const session = currentSessions[col]
  if (!session) return // empty column

  let command: Command | null = null
  if (row === 0) {
    // tapping the status key currently does nothing
    return
  } else if (row === 1) {
    command = session.state === 'ended' ? 'resume' : 'continue'
  } else if (row === 2) {
    command = session.state === 'ended' ? 'dismiss' : 'focus'
  }
  if (!command) return
  console.log(`[keypad] col ${col} (${session.session_id.slice(0, 8)}…) state=${session.state} → ${command}`)
  sidecar.sendCommand(session.session_id, command)
  // Optimistic local update — flip to thinking immediately so the LCD
  // shows feedback instantly. Next real sessions broadcast will correct
  // if Claude Code ends up in a different state.
  currentSessions = applyOptimisticUpdate(currentSessions, session.session_id, command)
  void repaint()
})

// Refresh tick. When any session is `thinking`, we paint faster so the dots
// animate; otherwise the slower idle cadence keeps us recovered from Options+.
let lastInterval = IDLE_REFRESH_MS
let timer: NodeJS.Timeout = setInterval(tick, IDLE_REFRESH_MS)
function tick() {
  void repaint()
  const desired = needsAnimation(currentSessions) ? ANIM_REFRESH_MS : IDLE_REFRESH_MS
  if (desired !== lastInterval) {
    clearInterval(timer)
    timer = setInterval(tick, desired)
    lastInterval = desired
  }
}
console.log(`[keypad] refresh: ${IDLE_REFRESH_MS}ms idle / ${ANIM_REFRESH_MS}ms when thinking`)

process.on('SIGINT', async () => {
  console.log('\n[keypad] closing...')
  clearInterval(timer)
  sidecar.close()
  await keypad.close()
  process.exit(0)
})
