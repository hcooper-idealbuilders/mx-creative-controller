// Replay the full host-out HID++ command sequence from the startup capture
// (in time order), while logging device responses. Then paint LCDs.
// If the device holds our paint, the missing piece is somewhere in this sequence.
import HID from 'node-hid'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const TSHARK = 'C:/Program Files/Wireshark/tshark.exe'
const PCAP   = '../captures/03-options-plus-startup.pcap'

// Locate the MX address in the capture.
const addrOut = execFileSync(TSHARK, [
  '-r', PCAP, '-Y', 'usb.idProduct == 0xc354',
  '-T', 'fields', '-e', 'usb.device_address',
], { encoding: 'utf8' })
const ADDR = Number([...new Set(addrOut.split('\n').map((s) => s.trim()).filter(Boolean))][0])
console.log(`MX address in capture: ${ADDR}`)

// Extract host-out HID++ packets (report 0x11 / 0x13) in time order.
// We exclude the steady-state heartbeat repeats (everything after the first
// 3 seconds of capture) to keep the replay focused on the *startup* sequence.
const out = execFileSync(TSHARK, [
  '-r', PCAP, '-Y',
  `usb.device_address == ${ADDR} && usb.src == "host" && (usbhid.data[0] == 0x11 || usbhid.data[0] == 0x13)`,
  '-T', 'fields', '-e', 'frame.time_relative', '-e', 'usbhid.data',
], { encoding: 'utf8' })
const startupPkts = out.split('\n').filter(Boolean).map((line) => {
  const [t, hex] = line.split('\t')
  return { t: Number(t), payload: Buffer.from(hex, 'hex') }
})
console.log(`HID++ packets in capture: ${startupPkts.length}`)
console.log(`time range: ${startupPkts[0]?.t.toFixed(2)}s → ${startupPkts.at(-1)?.t.toFixed(2)}s`)
// Drop the periodic heartbeats (they're the keepalive — we replay our own at the end).
const HEARTBEAT_PREFIX = '11ff041d0bb8'
const filtered = startupPkts.filter((p) => !p.payload.toString('hex').startsWith(HEARTBEAT_PREFIX))
console.log(`after stripping heartbeats: ${filtered.length} packets`)
startupPkts.length = 0
startupPkts.push(...filtered)

// Open both HID collections.
const all = await HID.devicesAsync()
const mxFor = (usage) => all.find(
  (d) => d.vendorId === 0x046d && d.productId === 0xc354 &&
         d.usagePage === 0xff43 && d.usage === usage,
)
const col1 = await HID.HIDAsync.open(mxFor(0x1a02).path) // HID++ short (0x11)
const col2 = await HID.HIDAsync.open(mxFor(0x1a08).path) // HID++ long  (0x13) — theory
const col3 = await HID.HIDAsync.open(mxFor(0x1a10).path) // LCD          (0x14)

// Log device responses as they come in (from BOTH HID++ collections).
let respCount = 0
const logResp = (label) => (buf) => {
  respCount++
  if (respCount <= 40) console.log(`  ←${label} ${buf.toString('hex')}`)
  else if (respCount === 41) console.log(`  ← ... (further responses suppressed)`)
}
col1.on('data', logResp('1'))
col2.on('data', logResp('2'))

// Replay the startup sequence. Route by report ID:
//   0x11 → Col01  (HID++ short)
//   0x13 → Col02  (HID++ long — hypothesis to test here)
console.log('\n=== replaying startup sequence ===')
let n11 = 0, n13 = 0, failed = []
for (let i = 0; i < startupPkts.length; i++) {
  const pkt = startupPkts[i]
  const target = pkt.payload[0] === 0x13 ? col2 : col1
  const label  = pkt.payload[0] === 0x13 ? 'col2' : 'col1'
  try {
    await target.write([...pkt.payload])
    if (pkt.payload[0] === 0x13) n13++; else n11++;
  } catch (err) {
    failed.push({ i, hex: pkt.payload.toString('hex'), label, err: err.message })
    console.log(`  ✗ #${i} on ${label} (${pkt.payload.toString('hex').slice(0, 24)}): ${err.message}`)
  }
  await new Promise((r) => setTimeout(r, 20))
}
console.log(`replayed ${n11} short + ${n13} long, ${failed.length} failures, ${respCount} responses`)

// Paint LCDs.
const lines = readFileSync('../captures/derived/binding-paint-frames.tsv', 'utf8').trim().split('\n')
const frames = lines.map((l) => Buffer.from(l.split('\t')[2], 'hex'))
console.log(`\n=== painting ${frames.length} LCD frames ===`)
for (const f of frames) await col3.write([...f])

// Now heartbeat for 20 seconds and watch.
const HEARTBEAT = Buffer.from('11ff041d0bb80000000000000000000000000000', 'hex')
console.log('\n=== heartbeating for 20s — watch the device ===')
const endAt = Date.now() + 20_000
while (Date.now() < endAt) {
  await col1.write([...HEARTBEAT])
  await new Promise((r) => setTimeout(r, 1000))
}

console.log('done. closing.')
await col1.close()
await col3.close()
