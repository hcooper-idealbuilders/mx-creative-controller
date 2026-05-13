// Out-paint the firmware: send the captured panel paint at high frequency.
// If the firmware refresh is ~2Hz, writing at 10Hz should dominate.
import HID from 'node-hid'
import { readFileSync } from 'node:fs'

const lines = readFileSync('../captures/derived/binding-paint-frames.tsv', 'utf8').trim().split('\n')
const frames = lines.map((l) => {
  const [, , hex] = l.split('\t')
  return Buffer.from(hex, 'hex')
})

const all = await HID.devicesAsync()
const lcdHid = all.find(
  (d) => d.vendorId === 0x046d && d.productId === 0xc354 &&
         d.usagePage === 0xff43 && d.usage === 0x1a10,
)
const dev = await HID.HIDAsync.open(lcdHid.path)
console.log('opened Col03 — looping panel paint for 10 seconds at 10Hz')

const endAt = Date.now() + 10_000
let cycle = 0
while (Date.now() < endAt) {
  for (const f of frames) {
    await dev.write([...f])
  }
  cycle++
  await new Promise((r) => setTimeout(r, 100))
}
console.log(`done. ${cycle} cycles. Did the LCD show our content continuously?`)
await dev.close()
