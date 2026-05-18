// Three-handle HID wrapper for the MX Creative Console keypad.
// Routes writes by report ID: 0x11→Col01, 0x13→Col02, 0x14→Col03.
// Listens for button input on Col01 (HID++ short) and Col02 (HID++ long).
import { EventEmitter } from 'node:events'
import HID, { type HIDAsync } from 'node-hid'
import { MXConsoleDefaultImageWriter } from '@logitech-mx-creative-console/core/dist/services/imageWriter/imageWriter.js'
import { JpegButtonLcdImagePacker } from '@logitech-mx-creative-console/core/dist/services/imagePacker/jpeg.js'
import { freezeDefinitions, generateButtonsGrid } from '@logitech-mx-creative-console/core/dist/controlsGenerator.js'
import { encodeJPEG } from '@logitech-mx-creative-console/node/dist/jpeg.js'

const VENDOR_ID  = 0x046d
const PRODUCT_ID = 0xc354
const PAGE       = 0xff43

interface ButtonControl {
  type: 'button'
  row: number
  column: number
  index: number
  hidId: number
  feedbackType: 'lcd' | 'none'
  pixelSize?: { width: number; height: number }
  pixelPosition?: { x: number; y: number }
}

// Same keypad model the lib uses internally. We only consume the 3×3 LCD
// grid (indices 0..8); the device's two row-3 page buttons fire HID++ short
// reports but we don't bind them, so they're omitted from CONTROLS.
const CONTROLS = freezeDefinitions(
  generateButtonsGrid(3, 3, { width: 118, height: 118 }, { x: 23, y: 6 }, { x: 40, y: 40 }),
) as ReadonlyArray<ButtonControl>

const LCD_CONTROLS = CONTROLS.filter(
  (c): c is ButtonControl & { pixelSize: { width: number; height: number }; pixelPosition: { x: number; y: number } } =>
    c.feedbackType === 'lcd',
)

export type PressEvent = { kind: 'down' | 'up'; control: ButtonControl }

export class MxKeypad extends EventEmitter {
  private col1!: HIDAsync
  private col2!: HIDAsync
  private col3!: HIDAsync
  private writer = new MXConsoleDefaultImageWriter()
  private packer = new JpegButtonLcdImagePacker((buf, w, h) => encodeJPEG(buf, w, h, undefined))
  private byHidId = new Map(CONTROLS.map((c) => [c.hidId, c]))
  private pressedLcd = new Set<number>()

  async open(): Promise<void> {
    const devices = await HID.devicesAsync()
    const find = (usage: number) => {
      const d = devices.find(
        (x) => x.vendorId === VENDOR_ID && x.productId === PRODUCT_ID &&
               x.usagePage === PAGE && x.usage === usage,
      )
      if (!d) throw new Error(`MX Creative Keypad HID path not found for usage 0x${usage.toString(16)}`)
      return d.path!
    }
    // col1 is opened (some Logitech firmware expects all three collections
    // claimed before LCD writes go through) but we don't listen — short
    // HID++ reports are only used by the unbound row-3 page buttons.
    this.col1 = await HID.HIDAsync.open(find(0x1a02))
    this.col2 = await HID.HIDAsync.open(find(0x1a08))
    this.col3 = await HID.HIDAsync.open(find(0x1a10))
    this.col2.on('data', (buf) => this.parseLongInput(buf))
  }

  async close(): Promise<void> {
    await Promise.all([this.col1?.close(), this.col2?.close(), this.col3?.close()])
  }

  /** Paint one of the 9 LCD keys with an RGBA pixel buffer (118×118 = 55,696 bytes). */
  async paintKey(keyIndex: number, rgba: Uint8Array): Promise<void> {
    const control = LCD_CONTROLS.find((c) => c.index === keyIndex)
    if (!control) throw new Error(`No LCD key with index ${keyIndex}`)
    const expected = control.pixelSize.width * control.pixelSize.height * 4
    if (rgba.length !== expected) {
      throw new Error(`Expected ${expected} RGBA bytes for key ${keyIndex}, got ${rgba.length}`)
    }
    const jpeg = await this.packer.convertPixelBuffer(
      rgba,
      { format: 'rgba', offset: 0, stride: control.pixelSize.width * 4 },
      control.pixelSize,
    )
    const packets = this.writer.generateFillImageWrites(
      { pixelSize: control.pixelSize, pixelPosition: control.pixelPosition },
      jpeg,
    )
    for (const p of packets) await this.col3.write([...p])
  }

  // ---- input parsers (mirroring the lib's KeypadInputService) ----

  private parseLongInput(buf: Buffer): void {
    const offset = buf[0] === 0x13 ? 1 : 0
    const d = buf.subarray(offset)
    if (d[0] !== 0xff || d[1] !== 0x02 || d[2] !== 0x00 || d[4] !== 0x01) return
    const now = new Set<number>()
    for (let i = 5; i < d.length; i++) {
      const v = d.readInt8(i)
      if (v === 0) break
      if (this.byHidId.has(v)) now.add(v)
    }
    this.diffPress(this.pressedLcd, now)
  }

  private diffPress(prev: Set<number>, now: Set<number>): void {
    for (const id of prev) if (!now.has(id)) {
      prev.delete(id)
      this.emit('press', { kind: 'up', control: this.byHidId.get(id)! })
    }
    for (const id of now) if (!prev.has(id)) {
      prev.add(id)
      this.emit('press', { kind: 'down', control: this.byHidId.get(id)! })
    }
  }
}
