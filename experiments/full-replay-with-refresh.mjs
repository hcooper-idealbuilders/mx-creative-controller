// Hypothesis: device reverts to default unless the host *continuously*
// repaints the LCDs. Full HID++ handshake + heartbeat + continuous LCD writes.
import HID from 'node-hid'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const TSHARK = 'C:/Program Files/Wireshark/tshark.exe'
const PCAP   = '../captures/03-options-plus-startup.pcap'

const addrOut = execFileSync(TSHARK, [
  '-r', PCAP, '-Y', 'usb.idProduct == 0xc354',
  '-T', 'fields', '-e', 'usb.device_address',
], { encoding: 'utf8' })
const ADDR = Number([...new Set(addrOut.split('\n').map((s) => s.trim()).filter(Boolean))][0])

const out = execFileSync(TSHARK, [
  '-r', PCAP, '-Y',
  `usb.device_address == ${ADDR} && usb.src == "host" && (usbhid.data[0] == 0x11 || usbhid.data[0] == 0x13)`,
  '-T', 'fields', '-e', 'usbhid.data',
], { encoding: 'utf8' })
const startupPkts = out.split('\n').filter(Boolean).map((hex) => Buffer.from(hex, 'hex'))
  .filter((b) => !b.toString('hex').startsWith('11ff041d0bb8'))

const all = await HID.devicesAsync()
const mxFor = (usage) => all.find(
  (d) => d.vendorId === 0x046d && d.productId === 0xc354 &&
         d.usagePage === 0xff43 && d.usage === usage,
)
const col1 = await HID.HIDAsync.open(mxFor(0x1a02).path)
const col2 = await HID.HIDAsync.open(mxFor(0x1a08).path)
const col3 = await HID.HIDAsync.open(mxFor(0x1a10).path)

// Drain responses
col1.on('data', () => {})
col2.on('data', () => {})

console.log(`replaying ${startupPkts.length} HID++ packets...`)
for (const pkt of startupPkts) {
  const target = pkt[0] === 0x13 ? col2 : col1
  await target.write([...pkt])
  await new Promise((r) => setTimeout(r, 20))
}
console.log('handshake done')

const lines = readFileSync('../captures/derived/binding-paint-frames.tsv', 'utf8').trim().split('\n')
const frames = lines.map((l) => Buffer.from(l.split('\t')[2], 'hex'))

console.log('starting 20s loop: 4Hz LCD refresh + 1Hz heartbeat. Watch the device.')
const HEARTBEAT = Buffer.from('11ff041d0bb80000000000000000000000000000', 'hex')
const endAt = Date.now() + 20_000
let lastHeartbeat = 0
let paints = 0
while (Date.now() < endAt) {
  for (const f of frames) await col3.write([...f])
  paints++
  if (Date.now() - lastHeartbeat > 1000) {
    await col1.write([...HEARTBEAT])
    lastHeartbeat = Date.now()
  }
  await new Promise((r) => setTimeout(r, 250)) // 4Hz
}
console.log(`done. ${paints} full panel repaints. closing.`)
await col1.close()
await col2.close()
await col3.close()
