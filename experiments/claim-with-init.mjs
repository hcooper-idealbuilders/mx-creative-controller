// Test: call feature 0x04 (the proprietary 0x0008 keepalive) function 0 ONCE,
// then heartbeat function 1 at 1Hz, while painting LCDs to Col03.
// If the device holds our paint, feature 0x0008 fn=0 was the missing init.
import HID from 'node-hid'
import { readFileSync } from 'node:fs'

// Feature 0x04 (index in the device's feature table = 0x04, ID = 0x0008).
// Captured from Options+'s startup behavior:
const FEAT_INIT      = Buffer.from('11ff040e00000000000000000000000000000000', 'hex') // fn=0
const FEAT_HEARTBEAT = Buffer.from('11ff041d0bb80000000000000000000000000000', 'hex') // fn=1 param=3000

const all = await HID.devicesAsync()
const mxFor = (usage) => all.find(
  (d) => d.vendorId === 0x046d && d.productId === 0xc354 &&
         d.usagePage === 0xff43 && d.usage === usage,
)
const col1 = await HID.HIDAsync.open(mxFor(0x1a02).path)
const col3 = await HID.HIDAsync.open(mxFor(0x1a10).path)
console.log('opened Col01 (HID++) and Col03 (LCD)')

console.log('feat 0x04 fn=0 (init keepalive)...')
await col1.write([...FEAT_INIT])
await new Promise((r) => setTimeout(r, 100))

console.log('feat 0x04 fn=1 (first heartbeat)...')
await col1.write([...FEAT_HEARTBEAT])
await new Promise((r) => setTimeout(r, 100))

const lines = readFileSync('../captures/derived/binding-paint-frames.tsv', 'utf8').trim().split('\n')
const frames = lines.map((l) => Buffer.from(l.split('\t')[2], 'hex'))
console.log(`painting ${frames.length} captured LCD frames to Col03...`)
for (const f of frames) await col3.write([...f])

console.log('heartbeating for 20s. Watch the device — does the paint stick?')
const endAt = Date.now() + 20_000
while (Date.now() < endAt) {
  await col1.write([...FEAT_HEARTBEAT])
  await new Promise((r) => setTimeout(r, 1000))
}

console.log('done. closing.')
await col1.close()
await col3.close()
