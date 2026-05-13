// Replicate Options+ behavior: heartbeat the "I'm the active host" packet on Col01
// at 1Hz while writing LCDs on Col03.
import HID from 'node-hid'
import { readFileSync } from 'node:fs'

const HEARTBEAT = Buffer.from('11ff041d0bb80000000000000000000000000000', 'hex')

const all = await HID.devicesAsync()
const mxFor = (usage) => all.find(
  (d) => d.vendorId === 0x046d && d.productId === 0xc354 &&
         d.usagePage === 0xff43 && d.usage === usage,
)
const col1 = await HID.HIDAsync.open(mxFor(0x1a02).path) // HID++ control
const col3 = await HID.HIDAsync.open(mxFor(0x1a10).path) // LCD data

console.log('sending initial heartbeat on Col01...')
await col1.write([...HEARTBEAT])

const lines = readFileSync('../captures/derived/binding-paint-frames.tsv', 'utf8').trim().split('\n')
const frames = lines.map((l) => Buffer.from(l.split('\t')[2], 'hex'))

console.log('painting all 5 captured frames to Col03...')
for (const f of frames) await col3.write([...f])

console.log('now heartbeating every 1s for 15 seconds. Watch the device.')
const endAt = Date.now() + 15_000
while (Date.now() < endAt) {
  await col1.write([...HEARTBEAT])
  await new Promise((r) => setTimeout(r, 1000))
}

console.log('done. Closing.')
await col1.close()
await col3.close()
