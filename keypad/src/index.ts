// Multi-session keypad controller.
//
// Layout (3 cols × 3 rows; sessions are FIFO):
//   row 0 — Claude mark per session, tinted by state; press cycles effort
//   row 1 — primary action  (Approve when waiting_input + permission prompt)
//   row 2 — secondary action (Focus)
import { MxKeypad, type PressEvent } from './device.js'
import { SidecarClient, type CommandResult } from './sidecar-client.js'
import { renderLayout, needsAnimation, renderStartupAnimation } from './renderer.js'
import { getEffectiveSessions, pruneOptimistic, type OptimisticEntry } from './optimistic.js'
import { isActionEnabled } from './labels.js'
import { recordError, pruneErrors } from './errors.js'
import { nextEffort, type EffortLevel } from './effort.js'
import type { Command, SessionStatus } from './state.js'
import { readFileSync } from 'node:fs'

const SIDECAR_URL = process.env.MX_SIDECAR_URL ?? 'ws://127.0.0.1:9876'
const IDLE_REFRESH_MS = Number(process.env.MX_REFRESH_MS ?? 1000)
const ANIM_REFRESH_MS = Number(process.env.MX_ANIM_MS ?? 200)

const keypad = new MxKeypad()

// Poll interval for both startup and replug detection. Generous (2s) —
// reconnect doesn't need to be instant.
const RECONNECT_INTERVAL_MS = 2000

// Wait for the device at startup instead of crashing. At logon this service
// can come up before USB enumeration finishes — or with the console unplugged
// entirely — and a bare open() here used to throw and kill the process.
if (!(await keypad.tryReopen())) {
  console.error('[keypad] device not found at startup — waiting for it to appear')
  while (!(await keypad.tryReopen())) {
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_INTERVAL_MS))
  }
}
console.log('[keypad] device open')

// Reconnect loop: when the MX Console is unplugged, device.ts marks itself
// disconnected and emits 'disconnect'. We poll for the device to reappear
// and resume painting as soon as open() succeeds again.
let reconnectTimer: NodeJS.Timeout | null = null
keypad.on('disconnect', () => {
  console.error('[keypad] device disconnected — waiting for replug')
  if (reconnectTimer) return
  reconnectTimer = setInterval(async () => {
    const ok = await keypad.tryReopen()
    if (!ok) return
    console.log('[keypad] device reconnected')
    clearInterval(reconnectTimer!)
    reconnectTimer = null
    void repaint()
  }, RECONNECT_INTERVAL_MS)
})

let currentSessions: SessionStatus[] = []
let painting = false

// Per-session optimistic state overlays. Each press that should produce
// visible state feedback (e.g. Approve → thinking) drops an entry here
// with a timestamp. Renderer overlays these atop the real state from the
// last sidecar broadcast; entries expire after OPTIMISTIC_HOLD_MS so a
// failed keystroke (no follow-up hook ever fires) doesn't strand the LCD.
let optimisticStates = new Map<string, OptimisticEntry>()
const OPTIMISTIC_HOLD_MS = 1500

// Startup-animation tracking. We want a ~1.2s flurry only when a brand-new
// Claude Code session appears (not on every hook event for an existing one).
// Tracking session_ids — not just a count — guards us against the rename
// race in update-status.ps1: the hook's Move-Item briefly looks like
// "directory empty, then directory full of session X again" to fsWatch,
// which would otherwise re-trigger the animation on every Approve/Stop.
const seenSessionIds = new Set<string>()
let animationStartedAt: number | null = null
const STARTUP_ANIM_MS = 1200

// Self-test results from the startup flurry. The flurry paints all 9 keys
// back-to-back, which makes it the natural moment to notice if any key has
// a USB hiccup, JPEG-encode glitch, or stale Col routing. Keys that throw
// during that window get a red error border for SELF_TEST_DISPLAY_MS so the
// user can see which one failed without watching console logs.
const selfTestFailures = new Set<number>()
let selfTestFailuresShownUntil: number | null = null
const SELF_TEST_DISPLAY_MS = 5000

// Track recent command failures so the keypad can flash an error border
// on a session whose press didn't reach Claude.
let errors = new Map<string, number>()
const ERROR_DISPLAY_MS = 2500

// Track the effort level the keypad most recently set, per session.
// Hooks don't surface Claude Code's actual effort level — for sessions
// the user hasn't cycled yet, fall back to the global default read once
// at startup from ~/.claude/settings.json.
const effortBySession = new Map<string, EffortLevel>()

function readGlobalDefaultEffort(): EffortLevel | null {
  const path = `${process.env.USERPROFILE}\\.claude\\settings.json`
  try {
    let raw = readFileSync(path, 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    const parsed = JSON.parse(raw) as { effortLevel?: string }
    const e = parsed.effortLevel
    if (e === 'low' || e === 'medium' || e === 'high' || e === 'xhigh') return e
  } catch (err) {
    console.error('[keypad] couldnt read effort default from settings.json:', (err as Error).message)
  }
  return null
}
const defaultEffort: EffortLevel | null = readGlobalDefaultEffort()
console.log(`[keypad] default effort: ${defaultEffort ?? '(unknown)'}`)

function effectiveEffort(sessionId: string): EffortLevel | null {
  return effortBySession.get(sessionId) ?? defaultEffort
}

// Compose the rgba buffers for the normal (non-flurry) layout. The error
// set is just the pruned-map's keys — pruneErrors() already filtered to the
// display window, so a second hasRecentError pass would be redundant.
function renderNormalLayout(now: number): Uint8Array[] {
  const errorSessionIds = new Set(errors.keys())
  const effective = getEffectiveSessions(currentSessions, optimisticStates, now, OPTIMISTIC_HOLD_MS)
  const effortView = new Map<string, EffortLevel>()
  for (const s of effective) {
    const e = effectiveEffort(s.session_id)
    if (e) effortView.set(s.session_id, e)
  }
  const failedKeyIndices =
    selfTestFailuresShownUntil !== null && now < selfTestFailuresShownUntil
      ? selfTestFailures
      : undefined
  return renderLayout(effective, { errorSessionIds, effortBySession: effortView, failedKeyIndices })
}

async function repaint() {
  if (painting) return
  painting = true
  try {
    const now = Date.now()
    errors = pruneErrors(errors, now, ERROR_DISPLAY_MS)
    optimisticStates = pruneOptimistic(optimisticStates, now, OPTIMISTIC_HOLD_MS)

    // Expire the self-test error display once its window has passed so the
    // red borders eventually clear themselves even if no other repaint
    // would otherwise overwrite them.
    if (selfTestFailuresShownUntil !== null && now >= selfTestFailuresShownUntil) {
      selfTestFailures.clear()
      selfTestFailuresShownUntil = null
    }

    // Startup flurry takes precedence over the normal layout while active.
    // We also use the flurry as a self-test: paint failures get recorded
    // here, then surfaced as red borders in the first normal layout.
    let rgbas: Uint8Array[]
    let inFlurry = false
    if (animationStartedAt !== null) {
      const elapsed = now - animationStartedAt
      if (elapsed < STARTUP_ANIM_MS) {
        rgbas = renderStartupAnimation(elapsed)
        inFlurry = true
      } else {
        animationStartedAt = null
        if (selfTestFailures.size > 0) {
          selfTestFailuresShownUntil = now + SELF_TEST_DISPLAY_MS
          console.error(`[keypad] self-test FAILED on keys: ${[...selfTestFailures].sort().join(', ')}`)
        } else {
          console.log('[keypad] self-test OK — all 9 keys painted')
        }
        rgbas = renderNormalLayout(now)
      }
    } else {
      rgbas = renderNormalLayout(now)
    }

    for (let i = 0; i < rgbas.length; i++) {
      try {
        await keypad.paintKey(i, rgbas[i])
      } catch (err) {
        console.error(`[keypad] paint key ${i} failed:`, err)
        if (inFlurry) selfTestFailures.add(i)
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
  // Cap at 3 visible (FIFO). Real state replaces wholesale — optimistic
  // overlays live in the separate map and are applied at paint time.
  const incoming = sessions.slice(0, 3)
  // Animation only fires when an incoming session_id is one we've never
  // seen in this keypad-service lifetime. Spurious empty broadcasts from
  // the hook rename race deliver the *same* session_id back, so the set
  // membership check filters them out cleanly.
  const hasGenuinelyNew = incoming.some((s) => !seenSessionIds.has(s.session_id))
  if (hasGenuinelyNew && animationStartedAt === null) {
    animationStartedAt = Date.now()
    console.log('[keypad] new session — playing startup flurry')
  }
  for (const s of incoming) seenSessionIds.add(s.session_id)
  currentSessions = incoming
  void repaint()
})
sidecar.on('close', () => {
  currentSessions = []
  void repaint()
})

sidecar.on('command-result', (res: CommandResult) => {
  if (res.success) return
  console.error(`[keypad] command failed: ${res.sessionId.slice(0, 8)}… ${res.command} — ${res.error ?? 'unknown'}`)
  errors = recordError(errors, res.sessionId, Date.now())
  // Drop the optimistic overlay so the real state shows immediately
  // (no more lying-thinking-dots while the user has nothing to do).
  optimisticStates.delete(res.sessionId)
  void repaint()
})

sidecar.connect()

// Tracks row-0 keys whose long-press already fired this hold, so the
// follow-up 'up' event doesn't *also* cycle effort. Cleared on each 'up'.
const longPressFired = new Set<number>()

// Press dispatcher — map key index → (column, row) → command + session.
keypad.on('press', (evt: PressEvent) => {
  const idx = evt.control.index
  const col = idx % 3
  const row = Math.floor(idx / 3)
  const session = currentSessions[col]
  if (!session) return

  // Row 0 has two gestures (tap → cycle effort, long-press → /fast) so it
  // fires on 'up' / 'long-press' rather than 'down'. Rows 1 & 2 keep firing
  // on 'down' for snappiness — they don't have a long-press behavior.
  if (row === 0) {
    if (evt.kind === 'long-press') {
      longPressFired.add(idx)
      console.log(`[keypad] col ${col} (${session.session_id.slice(0, 8)}…) long-press → /fast`)
      sidecar.sendCommand(session.session_id, 'fast')
      return
    }
    if (evt.kind === 'up') {
      if (longPressFired.delete(idx)) return  // long-press handled it
      const next = nextEffort(effortBySession.get(session.session_id) ?? null)
      effortBySession.set(session.session_id, next)
      console.log(`[keypad] col ${col} (${session.session_id.slice(0, 8)}…) effort → ${next}`)
      sidecar.sendCommand(session.session_id, `effort-${next}` as Command)
      void repaint()
    }
    return
  }

  if (evt.kind !== 'down') return

  let command: Command | null = null
  if (row === 1) {
    // Primary only fires on waiting_input AND when the notification text
    // looks like a permission prompt (per labels/isActionEnabled). Direction-
    // change questions deliberately leave Approve greyed so a press here
    // can't accidentally steer the work off course.
    if (!isActionEnabled(session.state, 'primary', session.notification_message)) {
      console.log(`[keypad] col ${col} state=${session.state} notif="${session.notification_message ?? ''}": primary disabled`)
      return
    }
    command = 'continue'
  } else if (row === 2) {
    command = 'focus'
  }
  if (!command) return
  console.log(`[keypad] col ${col} (${session.session_id.slice(0, 8)}…) state=${session.state} → ${command}`)
  sidecar.sendCommand(session.session_id, command)
  // Optimistic visual feedback: continue (Approve press) flips to thinking
  // so dots show immediately. Focus doesn't change state.
  if (command === 'continue') {
    optimisticStates.set(session.session_id, { state: 'thinking', at: Date.now() })
  }
  void repaint()
})

// Refresh tick. We paint faster when something is animating (startup flurry
// or any thinking session) so motion is smooth; otherwise the slower idle
// cadence keeps us recovered from Options+ repaints.
let lastInterval = IDLE_REFRESH_MS
let timer: NodeJS.Timeout = setInterval(tick, IDLE_REFRESH_MS)
function tick() {
  void repaint()
  const animating =
    animationStartedAt !== null ||
    needsAnimation(currentSessions)
  const desired = animating ? ANIM_REFRESH_MS : IDLE_REFRESH_MS
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
  if (reconnectTimer) clearInterval(reconnectTimer)
  sidecar.close()
  await keypad.close()
  process.exit(0)
})
