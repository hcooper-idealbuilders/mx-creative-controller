// Multi-session keypad controller.
//
// Layout (3 cols × 3 rows; sessions are FIFO):
//   row 0 — Claude mark per session, tinted by state
//   row 1 — primary action  (Continue / Approve / Resume per state)
//   row 2 — secondary action (Focus / Dismiss per state)
import { MxKeypad, type PressEvent } from './device.js'
import { SidecarClient, type CommandResult } from './sidecar-client.js'
import { renderLayout, needsAnimation } from './renderer.js'
import { applyOptimisticUpdate, mergeWithOptimistic } from './optimistic.js'
import { isActionEnabled } from './labels.js'
import {
  hasRecentError, recordError, pruneErrors,
  type CommandError,
} from './errors.js'
import type { Command, SessionStatus } from './state.js'

const SIDECAR_URL = process.env.MX_SIDECAR_URL ?? 'ws://127.0.0.1:9876'
const IDLE_REFRESH_MS = Number(process.env.MX_REFRESH_MS ?? 1000)
const ANIM_REFRESH_MS = Number(process.env.MX_ANIM_MS ?? 200)

const keypad = new MxKeypad()
await keypad.open()
console.log('[keypad] device open')

let currentSessions: SessionStatus[] = []
let painting = false

// Track when each session was last optimistically updated so an in-flight
// stale sidecar broadcast doesn't wipe the press feedback. 1.5s is long
// enough for the press to register visibly, short enough that real state
// changes (Stop → done, new Notification → waiting_input) feel snappy.
const optimisticAt = new Map<string, number>()
const OPTIMISTIC_HOLD_MS = 1500

// Track recent command failures so the keypad can flash an error border
// on a session whose press didn't reach Claude.
let errors = new Map<string, CommandError>()
const ERROR_DISPLAY_MS = 2500

async function repaint() {
  if (painting) return
  painting = true
  try {
    const now = Date.now()
    errors = pruneErrors(errors, now, ERROR_DISPLAY_MS)
    const errorSessionIds = new Set<string>()
    for (const [id] of errors) {
      if (hasRecentError(id, errors, now, ERROR_DISPLAY_MS)) errorSessionIds.add(id)
    }
    const rgbas = renderLayout(currentSessions, { errorSessionIds })
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
  // Cap at 3 visible (FIFO), then merge with any in-flight optimistic state.
  const incoming = sessions.slice(0, 3)
  currentSessions = mergeWithOptimistic(
    incoming, currentSessions, optimisticAt, Date.now(), OPTIMISTIC_HOLD_MS,
  )
  void repaint()
})
sidecar.on('close', () => {
  currentSessions = []
  void repaint()
})

sidecar.on('command-result', (res: CommandResult) => {
  if (res.success) return
  console.error(`[keypad] command failed: ${res.sessionId.slice(0, 8)}… ${res.command} — ${res.error ?? 'unknown'}`)
  errors = recordError(errors, res.sessionId, res.command, Date.now(), res.error)
  // Clear the optimistic hold for this session so the real state shows
  // through on the next broadcast (no more lying-thinking-dots).
  optimisticAt.delete(res.sessionId)
  void repaint()
})

sidecar.connect()

// Press dispatcher — map key index → (column, row) → command + session.
keypad.on('press', (evt: PressEvent) => {
  if (evt.kind !== 'down') return
  const idx = evt.control.index
  if (idx < 0 || idx > 8) return
  const col = idx % 3
  const row = Math.floor(idx / 3)
  const session = currentSessions[col]
  if (!session) return

  let command: Command | null = null
  if (row === 0) return // status key — render-only
  if (row === 1) {
    // Primary action gated by isActionEnabled — no stray 'continue\n' when
    // Claude is mid-thought or idle.
    if (!isActionEnabled(session.state, 'primary')) {
      console.log(`[keypad] col ${col} state=${session.state}: primary disabled`)
      return
    }
    command = session.state === 'ended' ? 'resume' : 'continue'
  } else if (row === 2) {
    command = session.state === 'ended' ? 'dismiss' : 'focus'
  }
  if (!command) return
  console.log(`[keypad] col ${col} (${session.session_id.slice(0, 8)}…) state=${session.state} → ${command}`)
  sidecar.sendCommand(session.session_id, command)
  currentSessions = applyOptimisticUpdate(currentSessions, session.session_id, command)
  optimisticAt.set(session.session_id, Date.now())
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
