// Replay a captured HID write to each Col path to find which accepts report 0x14
import HID from 'node-hid'
import { readFileSync } from 'node:fs'

const hex = readFileSync('../captures/derived/frame521.hex', 'utf8').trim()
const payload = Buffer.from(hex, 'hex')
console.log(`replay payload: ${payload.length} bytes, reportId=0x${payload[0].toString(16)}`)
console.log(`first 32 bytes: ${payload.slice(0, 32).toString('hex')}`)

const devices = await HID.devicesAsync()
const mx = devices.filter((d) =>
  d.vendorId === 0x046d && d.productId === 0xc354,
)
console.log(`\nfound ${mx.length} HID paths for MX Creative Keypad:\n`)

for (const info of mx) {
  const col = (info.path.match(/Col(\d+)/) || [])[1] ?? '?'
  const tag = `Col${col} (usage=0x${(info.usage ?? 0).toString(16)}, usagePage=0x${(info.usagePage ?? 0).toString(16)})`
  process.stdout.write(`${tag.padEnd(50)} `)
  let dev
  try {
    dev = await HID.HIDAsync.open(info.path)
    const written = await dev.write([...payload])
    console.log(`✓ WROTE ${written} bytes — check the device LCD!`)
  } catch (err) {
    console.log(`✗ ${err.message}`)
  } finally {
    try { await dev?.close() } catch {}
  }
}
