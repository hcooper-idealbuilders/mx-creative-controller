// Render one of the 9 keys (3×3 grid):
//   row 0 — status icon (Anthropic-style mark, colored by session state)
//   row 1 — primary action (Continue / Approve / Resume)
//   row 2 — secondary action (Focus / Dismiss)
//
// All sessions render their own column. Empty columns render dark.
import { Canvas, type SKRSContext2D, createCanvas } from '@napi-rs/canvas'
import { type SessionStatus, type SessionState, STATE_COLOR } from './state.js'

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

export function renderStatusKey(session: SessionStatus | null): Uint8Array {
  const { canvas, ctx } = makeCanvas('#0a0a0a')
  if (!session) {
    ctx.strokeStyle = '#222'
    ctx.lineWidth = 1
    ctx.strokeRect(8, 8, KEY - 16, KEY - 16)
    return toRgba(canvas)
  }

  const state = session.state
  const color = STATE_COLOR[state]

  // Mark (or thinking dots) in the upper 2/3.
  const cx = KEY / 2
  const cy = 42
  if (state === 'thinking') {
    drawThinkingDots(ctx, cx, cy)
  } else {
    drawClaudeMark(ctx, cx, cy, 26, color)
  }

  // Project name below the mark.
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 14px Inter, "Segoe UI", system-ui, sans-serif`
  const project = session.project ?? '—'
  ctx.fillText(truncate(ctx, project, KEY - 12), cx, 84)

  // Model in smaller muted text.
  ctx.fillStyle = '#888888'
  ctx.font = `500 10px Inter, "Segoe UI", system-ui, sans-serif`
  ctx.fillText(truncate(ctx, session.model ?? '', KEY - 12), cx, 102)

  return toRgba(canvas)
}

export function renderActionKey(
  session: SessionStatus | null,
  role: 'primary' | 'secondary',
): Uint8Array {
  if (!session) return toRgba(makeCanvas('#0a0a0a').canvas)

  let label = ''
  let bg = '#181818'
  let fg = '#ffffff'

  if (session.state === 'ended') {
    label = role === 'primary' ? 'Resume' : 'Dismiss'
    bg = role === 'primary' ? '#244a8c' : '#5a2727'
  } else {
    if (role === 'primary') {
      label = session.state === 'waiting_input' ? 'Approve' : 'Continue'
      bg = session.state === 'waiting_input' ? '#1f6f3a' : '#3a3a3a'
    } else {
      label = 'Focus'
      bg = '#1f4a7a'
    }
  }

  const { canvas, ctx } = makeCanvas(bg)
  ctx.fillStyle = fg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 22px Inter, "Segoe UI", system-ui, sans-serif`
  ctx.fillText(label, KEY / 2, KEY / 2)
  return toRgba(canvas)
}

/**
 * Render all 9 LCD keys for the current set of sessions.
 * Sessions are FIFO; column N renders sessions[N] (or empty if absent).
 * Returns one Uint8Array per key, key index = row * 3 + column.
 */
export function renderLayout(sessions: ReadonlyArray<SessionStatus>): Uint8Array[] {
  const out: Uint8Array[] = new Array(9)
  for (let col = 0; col < 3; col++) {
    const s = sessions[col] ?? null
    out[0 + col] = renderStatusKey(s)
    out[3 + col] = renderActionKey(s, 'primary')
    out[6 + col] = renderActionKey(s, 'secondary')
  }
  return out
}

/** True if any column is in a state that needs animation (currently just thinking). */
export function needsAnimation(sessions: ReadonlyArray<SessionStatus>): boolean {
  return sessions.some((s) => s.state === 'thinking')
}
