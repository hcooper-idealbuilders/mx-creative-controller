// Smoke test using the official lib BUT passing it the Col03 HID path
// instead of the default (Col01). If LCDs respond, Path B is fully alive.
import {
  listMXCreativeConsoleDevices,
  openMxCreativeConsole,
} from '@logitech-mx-creative-console/node'
import HID from 'node-hid'

// Use raw node-hid to find the Col03 path (vendor page 0xff43, usage 0x1a10)
const all = await HID.devicesAsync()
const lcdHid = all.find(
  (d) => d.vendorId === 0x046d && d.productId === 0xc354 &&
         d.usagePage === 0xff43 && d.usage === 0x1a10,
)
if (!lcdHid) { console.error('Col03 path not found'); process.exit(1) }
console.log('LCD collection path:', lcdHid.path)

const dev = await openMxCreativeConsole(lcdHid.path, { resetToLogoOnClose: false })
console.log(`opened: ${dev.PRODUCT_NAME}`)

console.log('setBrightness(80)...')
await dev.setBrightness(80)

console.log('clearPanel()...')
await dev.clearPanel()

console.log('cycling key 0: red -> green -> blue ...')
for (const [r, g, b] of [[255,0,0],[0,255,0],[0,0,255]]) {
  await dev.fillKeyColor(0, r, g, b)
  await new Promise((r) => setTimeout(r, 600))
}
console.log('painting keys 1..8 with different colors...')
const colors = [[255,128,0],[255,255,0],[128,255,0],[0,255,128],[0,255,255],[0,128,255],[128,0,255],[255,0,255]]
for (let i = 0; i < colors.length; i++) {
  const [r,g,b] = colors[i]
  await dev.fillKeyColor(i + 1, r, g, b)
}
console.log('all 9 keys painted. Holding 3s, then clearing...')
await new Promise((r) => setTimeout(r, 3000))
await dev.clearPanel()
await dev.close()
console.log('done.')
