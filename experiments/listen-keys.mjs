// Listen for keypad button events on Col01 (short reports) and Col02 (long reports).
// Mirrors @logitech-mx-creative-console/core's KeypadInputService logic but with
// our own multi-handle routing.
import HID from 'node-hid'
import { freezeDefinitions, generateButtonsGrid } from '@logitech-mx-creative-console/core/dist/controlsGenerator.js'

// Same as the lib's keypad model — 3×3 LCD grid + 2 non-LCD buttons (row 3).
const CONTROLS = freezeDefinitions([
  ...generateButtonsGrid(3, 3, { width: 118, height: 118 }, { x: 23, y: 6 }, { x: 40, y: 40 }),
  { type: 'button', row: 3, column: 0, index: 9,  hidId: 0x01a1, feedbackType: 'none' },
  { type: 'button', row: 3, column: 1, index: 10, hidId: 0x01a2, feedbackType: 'none' },
])
const byHidId = new Map(CONTROLS.filter((c) => c.type === 'button').map((c) => [c.hidId, c]))
console.log('button hidIds:', [...byHidId.keys()].map((id) => '0x' + id.toString(16)).join(', '))

const all = await HID.devicesAsync()
const mxFor = (usage) => all.find(
  (d) => d.vendorId === 0x046d && d.productId === 0xc354 &&
         d.usagePage === 0xff43 && d.usage === usage,
)
const col1 = await HID.HIDAsync.open(mxFor(0x1a02).path)
const col2 = await HID.HIDAsync.open(mxFor(0x1a08).path)
console.log('opened Col01 and Col02 — press keys on the keypad; Ctrl+C to quit\n')

const pressedLcd = new Set()
const pressedPage = new Set()

const labelFor = (c) => c.row === 3
  ? `row3-btn ${c.column}  (hidId 0x${c.hidId.toString(16)})`
  : `LCD key ${c.index}  (row ${c.row}, col ${c.column})`

// 0x13 (long) — LCD button presses arrive on Col02.
col2.on('data', (buf) => {
  // node-hid strips the report ID byte; buf[0] is the first payload byte.
  // But the lib's logic skips byte 0 expecting 0xff there, so node-hid is
  // INCLUDING the report ID. Detect either way.
  const offset = buf[0] === 0x13 ? 1 : 0
  const d = buf.subarray(offset)
  if (d[0] !== 0xff || d[1] !== 0x02 || d[2] !== 0x00 || d[4] !== 0x01) return
  const nowPressed = new Set()
  for (let i = 5; i < d.length; i++) {
    const v = d.readInt8(i)
    if (v === 0) break
    if (byHidId.has(v)) nowPressed.add(v)
  }
  // Edge-detect ups
  for (const id of pressedLcd) if (!nowPressed.has(id)) {
    console.log(`  ↑ ${labelFor(byHidId.get(id))}`)
    pressedLcd.delete(id)
  }
  // Edge-detect downs
  for (const id of nowPressed) if (!pressedLcd.has(id)) {
    console.log(`  ↓ ${labelFor(byHidId.get(id))}`)
    pressedLcd.add(id)
  }
})

// 0x11 (short) — non-LCD button presses arrive on Col01.
col1.on('data', (buf) => {
  const offset = buf[0] === 0x11 ? 1 : 0
  const d = buf.subarray(offset)
  if (d[0] !== 0xff || d[1] !== 0x0b || d[2] !== 0x00) return
  const nowPressed = new Set()
  for (let i = 3; i + 1 < d.length; i += 2) {
    const v = d.readUInt16BE(i)
    if (v === 0) break
    if (byHidId.has(v)) nowPressed.add(v)
  }
  for (const id of pressedPage) if (!nowPressed.has(id)) {
    console.log(`  ↑ ${labelFor(byHidId.get(id))}`)
    pressedPage.delete(id)
  }
  for (const id of nowPressed) if (!pressedPage.has(id)) {
    console.log(`  ↓ ${labelFor(byHidId.get(id))}`)
    pressedPage.add(id)
  }
})

process.on('SIGINT', async () => {
  console.log('\nclosing...')
  await col1.close()
  await col2.close()
  process.exit(0)
})
