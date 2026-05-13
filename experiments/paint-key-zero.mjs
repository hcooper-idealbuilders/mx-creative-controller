// Use the lib's image writer + JPEG packer to construct a *valid* "fill key 0 red"
// LCD-write sequence, and write each packet to Col03 directly via raw node-hid.
// This bypasses the lib's openMxCreativeConsole (which opens Col01 and chokes
// on init writes that would actually need Col01-but-different-report).
import HID from 'node-hid'
import { MXConsoleDefaultImageWriter } from '@logitech-mx-creative-console/core/dist/services/imageWriter/imageWriter.js'
import { JpegButtonLcdImagePacker } from '@logitech-mx-creative-console/core/dist/services/imagePacker/jpeg.js'
import { encodeJPEG } from '@logitech-mx-creative-console/node/dist/jpeg.js'

// Key 0 geometry from the lib's mx-creative-keypad model:
// generateButtonsGrid(3, 3, {width:118, height:118}, {x:23, y:6}, {x:40, y:40})
// → key 0 (row 0, col 0): position (23, 6), size 118×118
const KEY0 = { pixelPosition: { x: 23, y: 6 }, pixelSize: { width: 118, height: 118 } }

// Open Col03 (vendor page 0xff43, usage 0x1a10) — the LCD-write collection.
const all = await HID.devicesAsync()
const lcdHid = all.find(
  (d) => d.vendorId === 0x046d && d.productId === 0xc354 &&
         d.usagePage === 0xff43 && d.usage === 0x1a10,
)
const col3 = await HID.HIDAsync.open(lcdHid.path)
console.log(`opened Col03: ${lcdHid.path}`)

// Build a solid-red RGBA pixel buffer for key 0.
const pixelCount = KEY0.pixelSize.width * KEY0.pixelSize.height
const pixels = new Uint8Array(pixelCount * 4)
for (let i = 0; i < pixelCount; i++) {
  pixels[i * 4 + 0] = 255  // R
  pixels[i * 4 + 1] = 0    // G
  pixels[i * 4 + 2] = 0    // B
  pixels[i * 4 + 3] = 255  // A
}

// Pack as JPEG via the lib's packer.
const packer = new JpegButtonLcdImagePacker((buf, w, h) => encodeJPEG(buf, w, h))
const jpegBytes = await packer.convertPixelBuffer(
  pixels,
  { format: 'rgba', offset: 0, stride: KEY0.pixelSize.width * 4 },
  KEY0.pixelSize,
)
console.log(`JPEG-encoded ${KEY0.pixelSize.width}x${KEY0.pixelSize.height} red square: ${jpegBytes.length} bytes`)

// Generate the LCD write packets via the lib's image writer.
const writer = new MXConsoleDefaultImageWriter()
const packets = writer.generateFillImageWrites(KEY0, jpegBytes)
console.log(`generated ${packets.length} packet(s):`)
for (const p of packets) {
  console.log(`  ${Buffer.from(p.slice(0, 20)).toString('hex')}... (${p.length} bytes)`)
}

// Write each packet to Col03.
for (let i = 0; i < packets.length; i++) {
  const written = await col3.write([...packets[i]])
  console.log(`packet ${i}: wrote ${written} bytes`)
}
console.log('done. Key 0 should now be solid red — watch for ~5 seconds.')
await new Promise((r) => setTimeout(r, 5000))
await col3.close()
