// Replay all 5 captured LCD-write packets to Col03, in order.
// Watch the device — LCDs should change.
import HID from 'node-hid'
import { readFileSync } from 'node:fs'

const lines = readFileSync('../captures/derived/binding-paint-frames.tsv', 'utf8').trim().split('\n')
const frames = lines.map((l) => {
  const [num, t, hex] = l.split('\t')
  return { num, t, payload: Buffer.from(hex, 'hex') }
})
console.log(`replaying ${frames.length} frames`)

const all = await HID.devicesAsync()
const lcdHid = all.find(
  (d) => d.vendorId === 0x046d && d.productId === 0xc354 &&
         d.usagePage === 0xff43 && d.usage === 0x1a10,
)
const dev = await HID.HIDAsync.open(lcdHid.path)
console.log('opened Col03')

for (const f of frames) {
  const w = await dev.write([...f.payload])
  console.log(`frame ${f.num}: wrote ${w} bytes (report=0x${f.payload[0].toString(16)})`)
  await new Promise((r) => setTimeout(r, 50))
}
await dev.close()
console.log('done. Did the LCDs change?')
