import {
  listMXCreativeConsoleDevices,
  openMxCreativeConsole,
} from '@logitech-mx-creative-console/node'

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

log('scanning for MX Creative Console devices...')
const devices = await listMXCreativeConsoleDevices()
if (devices.length === 0) {
  console.error('no MX Creative Console found over HID')
  console.error('make sure the device is plugged in and Logi Options+ is running')
  process.exit(1)
}
log('found:', devices)

const dev = await openMxCreativeConsole(devices[0].path, {
  resetToLogoOnClose: true,
})
log('opened:', dev.PRODUCT_NAME, '/', dev.MODEL)

const buttons = dev.CONTROLS.filter((c) => c.type === 'button')
const lcdButtons = buttons.filter((c) => c.feedbackType === 'lcd')
const encoders = dev.CONTROLS.filter((c) => c.type === 'encoder')
log(`controls: ${buttons.length} buttons (${lcdButtons.length} with LCD), ${encoders.length} encoders`)

await dev.setBrightness(80)
await dev.clearPanel()

const colors = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
]
for (const [r, g, b] of colors) {
  await dev.fillKeyColor(0, r, g, b)
  log(`key 0 -> rgb(${r},${g},${b})`)
  await new Promise((r) => setTimeout(r, 700))
}
await dev.clearKey(0)
log('key 0 cleared. LCD writes work.')

const ctrlLabel = (c) =>
  c.type === 'button'
    ? `button #${c.index} (r${c.row} c${c.column}, ${c.feedbackType})`
    : `encoder #${c.index} (r${c.row} c${c.column})`

dev.on('down', (c) => log('DOWN  ', ctrlLabel(c)))
dev.on('up',   (c) => log('UP    ', ctrlLabel(c)))
dev.on('rotate', (c, amount) => log('ROTATE', ctrlLabel(c), `delta=${amount}`))
dev.on('error', (e) => console.error('ERROR', e))

console.log('')
console.log('-----------------------------------------------------------')
console.log(' Smoke test running. Try this:')
console.log('  1. Press the 9 keypad keys      — expect DOWN/UP for buttons')
console.log('  2. Turn and press the dialpad   — expect ROTATE / DOWN / UP')
console.log('  3. While turning a dialpad encoder, verify whatever you have')
console.log('     bound to it in Logi Options+ ALSO fires (coexistence test)')
console.log('  4. Ctrl+C to exit cleanly')
console.log('-----------------------------------------------------------')
console.log('')

let closing = false
const shutdown = async () => {
  if (closing) return
  closing = true
  log('closing device...')
  try { await dev.close() } catch (e) { console.error('close error:', e) }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
