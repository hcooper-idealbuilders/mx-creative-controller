// Paint all 9 LCD keys with distinct colors using the lib's image-writer
// algorithm, writing each packet directly to Col03.
import HID from 'node-hid'
import { MXConsoleDefaultImageWriter } from '@logitech-mx-creative-console/core/dist/services/imageWriter/imageWriter.js'
import { JpegButtonLcdImagePacker } from '@logitech-mx-creative-console/core/dist/services/imagePacker/jpeg.js'
import { encodeJPEG } from '@logitech-mx-creative-console/node/dist/jpeg.js'

// 3×3 grid from the keypad model: width=118, height=118, origin (23,6), gap (40,40).
const KEY_SIZE = { width: 118, height: 118 }
const ORIGIN   = { x: 23, y: 6 }
const GAP      = { x: 40, y: 40 }
const positionFor = (row, col) => ({
  x: ORIGIN.x + col * (KEY_SIZE.width + GAP.x),
  y: ORIGIN.y + row * (KEY_SIZE.height + GAP.y),
})

// 9-color rainbow.
const COLORS = [
  [255,   0,   0], // red
  [255, 128,   0], // orange
  [255, 255,   0], // yellow
  [  0, 255,   0], // green
  [  0, 255, 255], // cyan
  [  0,   0, 255], // blue
  [128,   0, 255], // purple
  [255,   0, 255], // magenta
  [255, 255, 255], // white
]

const all = await HID.devicesAsync()
const lcdHid = all.find(
  (d) => d.vendorId === 0x046d && d.productId === 0xc354 &&
         d.usagePage === 0xff43 && d.usage === 0x1a10,
)
const col3 = await HID.HIDAsync.open(lcdHid.path)
console.log('opened Col03')

const writer = new MXConsoleDefaultImageWriter()
const packer = new JpegButtonLcdImagePacker((buf, w, h) => encodeJPEG(buf, w, h))
const pixelCount = KEY_SIZE.width * KEY_SIZE.height

for (let i = 0; i < 9; i++) {
  const row = Math.floor(i / 3)
  const col = i % 3
  const [r, g, b] = COLORS[i]
  const pixels = new Uint8Array(pixelCount * 4)
  for (let p = 0; p < pixelCount; p++) {
    pixels[p * 4 + 0] = r
    pixels[p * 4 + 1] = g
    pixels[p * 4 + 2] = b
    pixels[p * 4 + 3] = 255
  }
  const jpegBytes = await packer.convertPixelBuffer(
    pixels,
    { format: 'rgba', offset: 0, stride: KEY_SIZE.width * 4 },
    KEY_SIZE,
  )
  const packets = writer.generateFillImageWrites(
    { pixelPosition: positionFor(row, col), pixelSize: KEY_SIZE },
    jpegBytes,
  )
  for (const p of packets) await col3.write([...p])
  console.log(`key ${i} (row ${row}, col ${col}): rgb(${r},${g},${b})  →  ${packets.length} packet(s), ${jpegBytes.length}-byte JPEG`)
}

await col3.close()
console.log('done. Painted 9 keys. Holds without further writes.')
