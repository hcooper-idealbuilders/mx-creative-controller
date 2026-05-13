// Render each key's 118×118 LCD content as an RGBA buffer.
import { Canvas, type SKRSContext2D, createCanvas } from '@napi-rs/canvas'
import {
  type ClaudeState, type KeySlot, type Status,
  STATE_COLOR, LAYOUT,
} from './state.js'

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

function fitText(ctx: SKRSContext2D, text: string, maxWidth: number, basePx: number): string {
  let px = basePx
  ctx.font = `600 ${px}px Inter, "Segoe UI", system-ui, sans-serif`
  while (ctx.measureText(text).width > maxWidth && px > 10) {
    px -= 1
    ctx.font = `600 ${px}px Inter, "Segoe UI", system-ui, sans-serif`
  }
  return ctx.font
}

// Truncate with ellipsis if measured width exceeds limit at the given font.
function truncate(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) {
    s = s.slice(0, -1)
  }
  return s + '…'
}

export function renderStatusKey(status: Status | null): Uint8Array {
  const state: ClaudeState | 'offline' = status?.state ?? 'offline'
  const bg = STATE_COLOR[state]
  const { canvas, ctx } = makeCanvas('#0a0a0a')

  // State color band along the top.
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, KEY, 26)

  // State label
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.font = `700 14px Inter, "Segoe UI", system-ui, sans-serif`
  const stateLabel = state.toUpperCase().replace('_', ' ')
  ctx.fillText(stateLabel, 6, 13)

  // Project name (large, center)
  const project = status?.project ?? 'no session'
  ctx.fillStyle = '#ffffff'
  fitText(ctx, project, KEY - 12, 22)
  ctx.textBaseline = 'middle'
  ctx.fillText(truncate(ctx, project, KEY - 12), 6, 58)

  // Model
  ctx.fillStyle = '#aaaaaa'
  ctx.font = `500 12px Inter, "Segoe UI", system-ui, sans-serif`
  ctx.fillText(truncate(ctx, status?.model ?? '—', KEY - 12), 6, 86)

  // Footer hint
  ctx.fillStyle = '#666666'
  ctx.font = `500 10px Inter, "Segoe UI", system-ui, sans-serif`
  ctx.fillText(status?.fast_mode ? 'fast mode' : '', 6, 106)

  return toRgba(canvas)
}

export function renderActionKey(slot: KeySlot, dim: boolean): Uint8Array {
  if (slot.kind === 'blank' || !slot.label) {
    return toRgba(makeCanvas('#181818').canvas)
  }
  const bg = slot.bg ?? '#333333'
  const { canvas, ctx } = makeCanvas(dim ? darken(bg, 0.5) : bg)

  ctx.fillStyle = dim ? '#888888' : '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  fitText(ctx, slot.label, KEY - 12, 26)
  ctx.fillText(slot.label, KEY / 2, KEY / 2)
  return toRgba(canvas)
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

export function renderLayout(status: Status | null): Uint8Array[] {
  const liveAction = status?.state === 'done' || status?.state === 'waiting_input'
  return LAYOUT.map((slot) => {
    if (slot.kind === 'status') return renderStatusKey(status)
    return renderActionKey(slot, !liveAction)
  })
}
