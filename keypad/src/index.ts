// Wire the MX Creative Console keypad to the Claude Code sidecar.
//   - LCDs render Claude's live status + response-key labels
//   - Hardware key presses dispatch commands to the sidecar over WebSocket
import { MxKeypad, type PressEvent } from './device.js'
import { SidecarClient } from './sidecar-client.js'
import { renderLayout } from './renderer.js'
import { LAYOUT, type Status } from './state.js'

const SIDECAR_URL = process.env.MX_SIDECAR_URL ?? 'ws://127.0.0.1:9876'

const keypad = new MxKeypad()
await keypad.open()
console.log('[keypad] device open')

let currentStatus: Status | null = null
let painting = false

async function repaint() {
  if (painting) return // skip if previous still in flight
  painting = true
  try {
    const rgbas = renderLayout(currentStatus)
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

// Initial paint with offline state until the sidecar speaks.
await repaint()

// Periodic refresh: Logi Options+ repaints the device on every foreground-app
// change (its app-focus profile system), wiping our content. Re-paint at 1Hz
// to win the visible state.
const REFRESH_MS = Number(process.env.MX_REFRESH_MS ?? 1000)
setInterval(() => { void repaint() }, REFRESH_MS)
console.log(`[keypad] periodic refresh every ${REFRESH_MS}ms`)

const sidecar = new SidecarClient(SIDECAR_URL)
sidecar.on('status', async (status: Status) => {
  currentStatus = status
  await repaint()
})
sidecar.on('close', async () => {
  console.log('[sidecar-client] disconnected — repainting as offline')
  currentStatus = null
  await repaint()
})
sidecar.connect()

// Dispatch key presses → sidecar commands.
keypad.on('press', (evt: PressEvent) => {
  if (evt.kind !== 'down') return
  const slot = LAYOUT[evt.control.index]
  if (!slot || slot.kind !== 'action' || !slot.command) return
  console.log(`[keypad] press → command: ${slot.command}`)
  sidecar.sendCommand(slot.command)
})

process.on('SIGINT', async () => {
  console.log('\n[keypad] closing...')
  sidecar.close()
  await keypad.close()
  process.exit(0)
})
