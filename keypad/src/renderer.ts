// Render one of the 9 keys (3×3 grid):
//   row 0 — status icon (Anthropic-style mark, colored by session state)
//   row 1 — primary action (Continue / Approve / Resume)
//   row 2 — secondary action (Focus / Dismiss)
//
// All sessions render their own column. Empty columns render dark.
import { Canvas, type SKRSContext2D, createCanvas } from '@napi-rs/canvas'
import { type SessionStatus, type SessionState, STATE_COLOR, STATE_BG } from './state.js'
import { actionLabel, actionBg, isActionEnabled, type ActionRole } from './labels.js'
import { type EffortLevel, effortLabel } from './effort.js'
import { formatTitle, formatModel } from './format.js'

const KEY = 118

function makeCanvas(bg: string): { canvas: Canvas; ctx: SKRSContext2D } {
  const canvas = createCanvas(KEY, KEY)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, KEY, KEY)
  return { canvas, ctx }
}

function toRgba(canvas: Canvas): Uint8Array {
  const data = canvas.getContext('2d').getImageData(0, 0, KEY, KEY).data
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function truncate(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) {
    s = s.slice(0, -1)
  }
  return s + '…'
}

// Stylized 3-stroke mark — a vertical bar plus two diagonals through center.
// Evokes the Anthropic / Claude logomark.
function drawClaudeMark(ctx: SKRSContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(8, r * 0.32)
  ctx.lineCap = 'round'
  const dx = r * 0.866 // cos(30°)
  const dy = r * 0.5   // sin(30°)
  ctx.beginPath()
  ctx.moveTo(cx, cy - r);       ctx.lineTo(cx, cy + r)
  ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx + dx, cy + dy)
  ctx.moveTo(cx + dx, cy - dy); ctx.lineTo(cx - dx, cy + dy)
  ctx.stroke()
}

// Two pulsing dots, used when state === 'thinking'. Pulse derived from Date.now()
// so successive paints animate.
function drawThinkingDots(ctx: SKRSContext2D, cx: number, cy: number) {
  const t = (Date.now() % 1200) / 1200
  const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2))
  const b = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((t + 0.5) * Math.PI * 2))
  ctx.fillStyle = `rgba(255,255,255,${a})`
  ctx.beginPath(); ctx.arc(cx - 16, cy, 10, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = `rgba(255,255,255,${b})`
  ctx.beginPath(); ctx.arc(cx + 16, cy, 10, 0, Math.PI * 2); ctx.fill()
}

export function renderStatusKey(
  session: SessionStatus | null,
  options?: { error?: boolean; effort?: EffortLevel | null },
): Uint8Array {
  // No session in this column — render an empty/dark tile.
  if (!session) {
    const { canvas, ctx } = makeCanvas('#0a0a0a')
    ctx.strokeStyle = '#222'
    ctx.lineWidth = 1
    ctx.strokeRect(8, 8, KEY - 16, KEY - 16)
    if (options?.error) drawErrorBorder(ctx)
    return toRgba(canvas)
  }

  const state = session.state
  const bg    = STATE_BG[state]
  const { canvas, ctx } = makeCanvas(bg)
  const cx = KEY / 2

  // Tinted Claude mark sitting behind the text — gives the colored tile a
  // sense of depth without competing with the label. Skipped in 'thinking'
  // since the pulsing dots are the focal point there.
  if (state !== 'thinking') {
    drawClaudeMark(ctx, cx, KEY / 2, 30, darken(bg, 0.7))
  }

  // Row 1 — title (one word, max 12 chars). Always visible, including in
  // thinking state, so the user can still tell which session is which.
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = `700 14px Inter, "Segoe UI", system-ui, sans-serif`
  ctx.fillText(formatTitle(session.project), cx, 8)

  if (state === 'thinking') {
    // Title only; dots center of the tile.
    drawThinkingDots(ctx, cx, 74)
  } else {
    // Row 2 — model, simplified, tight under the title
    ctx.fillStyle = '#ffffffdd'
    ctx.font = `600 13px Inter, "Segoe UI", system-ui, sans-serif`
    ctx.fillText(formatModel(session.model), cx, 32)

    // Row 3 — effort level word, just below the model
    ctx.fillStyle = '#ffffffaa'
    ctx.font = `700 12px Inter, "Segoe UI", system-ui, sans-serif`
    ctx.fillText(options?.effort ? effortLabel(options.effort) : '', cx, 56)
  }

  if (options?.error) drawErrorBorder(ctx)
  return toRgba(canvas)
}

/**
 * 9-colour rainbow palette for the "no sessions yet" screensaver. One
 * Claude mark per key, distinct hues so it's obvious at a glance that
 * the controller is running even when there's no Claude Code session
 * to interact with.
 */
const SCREENSAVER_PALETTE: ReadonlyArray<string> = [
  '#ff4d4d', '#ff8c1a', '#ffd633',
  '#4dd66b', '#33cccc', '#4d8cff',
  '#8c4dff', '#ff4dcc', '#ffffff',
]

function renderScreensaverTile(idx: number): Uint8Array {
  const { canvas, ctx } = makeCanvas('#0a0a0a')
  drawClaudeMark(ctx, KEY / 2, KEY / 2, 34, SCREENSAVER_PALETTE[idx % SCREENSAVER_PALETTE.length])
  return toRgba(canvas)
}

/**
 * Brief flurry shown when sessions transition from empty (screensaver) to
 * non-empty. Each tile cycles through the screensaver palette, offset by
 * its index so the keys feel like they're sweeping. After the window
 * (~1.2s) the caller switches back to the normal status layout.
 */
export function renderStartupAnimation(elapsedMs: number): Uint8Array[] {
  const colorsPerSecond = 10
  const baseOffset = Math.floor((elapsedMs * colorsPerSecond) / 1000)
  const out: Uint8Array[] = new Array(9)
  for (let i = 0; i < 9; i++) {
    const colorIdx = (i + baseOffset) % SCREENSAVER_PALETTE.length
    const { canvas, ctx } = makeCanvas('#0a0a0a')
    drawClaudeMark(ctx, KEY / 2, KEY / 2, 34, SCREENSAVER_PALETTE[colorIdx])
    out[i] = toRgba(canvas)
  }
  return out
}

function darken(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = Math.round(((n >> 16) & 0xff) * factor)
  const g = Math.round(((n >> 8) & 0xff) * factor)
  const b = Math.round((n & 0xff) * factor)
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
}

export function renderActionKey(
  session: SessionStatus | null,
  role: ActionRole,
  options?: { error?: boolean },
): Uint8Array {
  const state   = session?.state ?? null
  const enabled = isActionEnabled(state, role, session?.notification_message ?? null)
  const label   = actionLabel(state, role)
  const baseBg  = actionBg(state, role)
  const bg      = enabled ? baseBg : darken(baseBg, 0.4)
  const { canvas, ctx } = makeCanvas(bg)
  // Tinted mark behind the label — same depth treatment as the status tile.
  // Skipped on empty columns (no session) so blank tiles stay flat.
  if (session) {
    drawClaudeMark(ctx, KEY / 2, KEY / 2, 30, darken(bg, 0.7))
  }
  if (label) {
    ctx.fillStyle = enabled ? '#ffffff' : '#888888'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 22px Inter, "Segoe UI", system-ui, sans-serif`
    ctx.fillText(label, KEY / 2, KEY / 2)
  }
  if (options?.error) drawErrorBorder(ctx)
  return toRgba(canvas)
}

function drawErrorBorder(ctx: SKRSContext2D) {
  ctx.strokeStyle = '#ff3b30'
  ctx.lineWidth = 6
  ctx.strokeRect(3, 3, KEY - 6, KEY - 6)
}

/**
 * Render all 9 LCD keys for the current set of sessions.
 * Sessions are FIFO; column N renders sessions[N] (or empty if absent).
 * Returns one Uint8Array per key, key index = row * 3 + column.
 *
 * If a session has a recent error, its column gets a red border on the
 * status key to surface that the last command didn't reach Claude.
 */
export function renderLayout(
  sessions: ReadonlyArray<SessionStatus>,
  options?: {
    errorSessionIds?: ReadonlySet<string>
    effortBySession?: ReadonlyMap<string, EffortLevel>
  },
): Uint8Array[] {
  // Per-column: occupied columns render their session's status + action keys;
  // empty columns get the rainbow Claude-mark screensaver across all 3 rows
  // so the keypad keeps proving it's alive even with 1–2 active sessions.
  // The palette index is `row*3 + col`, matching the no-sessions layout, so
  // the unused slots stay color-coherent with the full screensaver.
  const errSet = options?.errorSessionIds ?? new Set<string>()
  const effortMap = options?.effortBySession
  const out: Uint8Array[] = new Array(9)
  for (let col = 0; col < 3; col++) {
    const s = sessions[col] ?? null
    if (!s) {
      out[0 + col] = renderScreensaverTile(0 + col)
      out[3 + col] = renderScreensaverTile(3 + col)
      out[6 + col] = renderScreensaverTile(6 + col)
      continue
    }
    const err = errSet.has(s.session_id)
    const effort = effortMap?.get(s.session_id) ?? null
    out[0 + col] = renderStatusKey(s, { error: err, effort })
    out[3 + col] = renderActionKey(s, 'primary')
    out[6 + col] = renderActionKey(s, 'secondary')
  }
  return out
}

/** True if any column is in a state that needs animation (currently just thinking). */
export function needsAnimation(sessions: ReadonlyArray<SessionStatus>): boolean {
  return sessions.some((s) => s.state === 'thinking')
}
