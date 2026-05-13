import {
  listMXCreativeConsoleDevices,
  openMxCreativeConsole,
} from '@logitech-mx-creative-console/node'

const devices = await listMXCreativeConsoleDevices()
console.log(`probing ${devices.length} HID interface(s) for writability...\n`)

for (let i = 0; i < devices.length; i++) {
  const info = devices[i]
  const colMatch = info.path.match(/Col(\d+)/)
  const tag = colMatch ? `Col${colMatch[1]}` : `path[${i}]`
  process.stdout.write(`${tag}  open…`)
  let dev
  try {
    dev = await openMxCreativeConsole(info.path, { resetToLogoOnClose: false })
    process.stdout.write(' ok  clearPanel…')
    await dev.clearPanel()
    process.stdout.write(' ok  fillKeyColor(0,red)…')
    await dev.fillKeyColor(0, 255, 0, 0)
    process.stdout.write(' ok  fillKeyColor(0,clear)…')
    await new Promise((r) => setTimeout(r, 300))
    await dev.clearKey(0)
    console.log(' ok  →  WRITABLE ✓')
  } catch (err) {
    console.log(`  →  ${err.message}`)
  } finally {
    try { await dev?.close() } catch {}
  }
}
console.log('\ndone.')
