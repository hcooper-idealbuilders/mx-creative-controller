// Multi-session keypad controller.
//
// Layout (3 cols × 3 rows; sessions are FIFO):
//   row 0 — Claude mark per session, tinted by state
//   row 1 — primary action  (Continue / Approve / Resume per state)
//   row 2 — secondary action (Focus / Dismiss per state)
import { MxKeypad, type PressEvent } from './device.js'
import { SidecarClient, type CommandResult } from './sidecar-client.js'
import { renderLayout, needsAnimation, renderStartupAnimation } from './renderer.js'
import { getEffectiveSessions, pruneOptimistic, type OptimisticEntry } from './optimistic.js'
import { isActionEnabled } from './labels.js'
import {
  hasRecentError, recordError, pruneErrors,
  type CommandError,
} from './errors.js'
import { nextEffort, type EffortLevel } from './effort.js'
import type { Command, SessionStatus } from './state.js'
import { readFileSync } from 'node:fs'

const SIDECAR_URL = process.env.MX_SIDECAR_URL ?? 'ws://127.0.0.1:9876'
const IDLE_REFRESH_MS = Number(process.env.MX_REFRESH_MS ?? 1000)
const ANIM_REFRESH_MS = Number(process.env.MX_ANIM_MS ?? 200)

const keypad = new MxKeypad()
await keypad.open()
console.log('[keypad] device open')

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

// Track recent command failures so the keypad can flash an error border
// on a session whose press didn't reach Claude.
let errors = new Map<string, CommandError>()
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

async function repaint() {
  if (painting) return
  painting = true
  try {
    const now = Date.now()
    errors = pruneErrors(errors, now, ERROR_DISPLAY_MS)
    optimisticStates = pruneOptimistic(optimisticStates, now, OPTIMISTIC_HOLD_MS)

    // Startup flurry takes precedence over the normal layout while active.
    let rgbas: Uint8Array[]
    if (animationStartedAt !== null) {
      const elapsed = now - animationStartedAt
      if (elapsed < STARTUP_ANIM_MS) {
        rgbas = renderStartupAnimation(elapsed)
      } else {
        animationStartedAt = null
        rgbas = renderNormal()
      }
    } else {
      rgbas = renderNormal()
    }

    function renderNormal(): Uint8Array[] {
      const errorSessionIds = new Set<string>()
      for (const [id] of errors) {
        if (hasRecentError(id, errors, now, ERROR_DISPLAY_MS)) errorSessionIds.add(id)
      }
      const effective = getEffectiveSessions(currentSessions, optimisticStates, now, OPTIMISTIC_HOLD_MS)
      const effortView = new Map<string, EffortLevel>()
      for (const s of effective) {
        const e = effectiveEffort(s.session_id)
        if (e) effortView.set(s.session_id, e)
      }
      return renderLayout(effective, { errorSessionIds, effortBySession: effortView })
    }
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
  errors = recordError(errors, res.sessionId, res.command, Date.now(), res.error)
  // Drop the optimistic overlay so the real state shows immediately
  // (no more lying-thinking-dots while the user has nothing to do).
  optimisticStates.delete(res.sessionId)
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
  if (row === 0) {
    // Status key cycles per-session effort level.
    const next = nextEffort(effortBySession.get(session.session_id) ?? null)
    effortBySession.set(session.session_id, next)
    const effortCmd = `effort-${next}` as Command
    console.log(`[keypad] col ${col} (${session.session_id.slice(0, 8)}…) effort → ${next}`)
    sidecar.sendCommand(session.session_id, effortCmd)
    void repaint()
    return
  }
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
  sidecar.close()
  await keypad.close()
  process.exit(0)
})
