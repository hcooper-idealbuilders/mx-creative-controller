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

export type PressEvent = { kind: 'down' | 'up' | 'long-press'; control: ButtonControl }

/**
 * Hold threshold for the long-press gesture. Below ~350ms feels twitchy;
 * much above ~500ms users start complaining a press "didn't register."
 */
const LONG_PRESS_MS = 450

/**
 * Cap on a single HID write. A wedged handle (device reset, Options+
 * re-enumeration) can leave write() pending forever — which froze the
 * repaint loop silently: the `painting` guard in index.ts never cleared,
 * no error was ever thrown, and the LCDs just stayed black. A timeout
 * converts the hang into an error we treat as a disconnect.
 */
const WRITE_TIMEOUT_MS = 2000

export class MxKeypad extends EventEmitter {
  private col1: HIDAsync | null = null
  private col2: HIDAsync | null = null
  private col3: HIDAsync | null = null
  private writer = new MXConsoleDefaultImageWriter()
  private packer = new JpegButtonLcdImagePacker((buf, w, h) => encodeJPEG(buf, w, h, undefined))
  private byHidId = new Map(CONTROLS.map((c) => [c.hidId, c]))
  private pressedLcd = new Set<number>()
  /** hidId → pending long-press timer, cleared on release or fire. */
  private holdTimers = new Map<number, NodeJS.Timeout>()
  private connected = false

  /** True between a successful open() and a detected disconnect. */
  isConnected(): boolean { return this.connected }

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
    //
    // Exception-safe: a partial open (e.g. col3 fails while the device is
    // still settling after a USB resume) must release what it grabbed, or
    // the leaked handles can block every subsequent reopen attempt forever.
    let c1: HIDAsync | null = null
    let c2: HIDAsync | null = null
    let c3: HIDAsync | null = null
    try {
      c1 = await HID.HIDAsync.open(find(0x1a02))
      c2 = await HID.HIDAsync.open(find(0x1a08))
      c3 = await HID.HIDAsync.open(find(0x1a10))
    } catch (err) {
      await Promise.allSettled([c1?.close(), c2?.close(), c3?.close()])
      throw err
    }
    this.col1 = c1
    this.col2 = c2
    this.col3 = c3
    // Wake the panels. The device firmware can dim the LCDs to zero on its
    // own (observed after an overnight USB suspend) — image writes then
    // "succeed" into a black screen. Asserting brightness on every open is
    // idempotent and guarantees painted content is actually visible.
    // HID++ short report (0x11) → col1; format from the lib's
    // DefaultPropertiesService.setBrightness.
    await c1.write([0x11, 0xff, 0x0f, 0x2b, 0x00, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    this.col2.on('data', (buf) => this.parseLongInput(buf))
    // Detect unplug: node-hid emits 'error' (and on some platforms 'close')
    // on each handle when the device disappears. First fire wins — we
    // tear down all three handles and signal the caller exactly once.
    const onLost = (label: string) => (err?: Error) => {
      if (!this.connected) return
      console.error(`[device] HID ${label} signaled disconnect${err ? `: ${err.message}` : ''}`)
      void this.handleDisconnect()
    }
    this.col1.on('error', onLost('col1 error'))
    this.col2.on('error', onLost('col2 error'))
    this.col3.on('error', onLost('col3 error'))
    this.col1.on('close', onLost('col1 close'))
    this.col2.on('close', onLost('col2 close'))
    this.col3.on('close', onLost('col3 close'))
    this.connected = true
  }

  /** Why the most recent tryReopen() failed — for the caller's diagnostics. */
  lastOpenError: string | null = null

  /**
   * Try to (re)open the device. Returns true on success, false when the
   * device isn't enumerable yet (caller polls). Safe to call repeatedly.
   */
  async tryReopen(): Promise<boolean> {
    if (this.connected) return true
    try {
      await this.open()
      this.lastOpenError = null
      return true
    } catch (err) {
      this.lastOpenError = (err as Error).message
      return false
    }
  }

  private async handleDisconnect(): Promise<void> {
    if (!this.connected) return
    this.connected = false
    this.pressedLcd.clear()
    // Close every handle best-effort; one of them is already in a bad
    // state but the others may need an explicit release before re-open
    // can succeed. A wedged handle's close() can itself hang — cap the
    // wait so 'disconnect' (and with it the reconnect loop) always fires.
    const handles = [this.col1, this.col2, this.col3]
    this.col1 = this.col2 = this.col3 = null
    await Promise.race([
      Promise.allSettled(handles.map((h) => h?.close())),
      new Promise<void>((resolve) => setTimeout(resolve, 1500).unref()),
    ])
    this.emit('disconnect')
  }

  async close(): Promise<void> {
    this.connected = false
    await Promise.allSettled([this.col1?.close(), this.col2?.close(), this.col3?.close()])
    this.col1 = this.col2 = this.col3 = null
  }

  /** Paint one of the 9 LCD keys with an RGBA pixel buffer (118×118 = 55,696 bytes). */
  async paintKey(keyIndex: number, rgba: Uint8Array): Promise<void> {
    if (!this.connected || !this.col3) return  // device gone — skip silently
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
    try {
      for (const p of packets) await this.writeWithTimeout(this.col3, [...p])
    } catch (err) {
      // A failed/hung LCD write means the handle is wedged — go through the
      // disconnect path so the reconnect loop reopens fresh handles.
      void this.handleDisconnect()
      throw err
    }
  }

  private async writeWithTimeout(handle: HIDAsync, data: number[]): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        handle.write(data),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`HID write timeout (${WRITE_TIMEOUT_MS}ms)`)), WRITE_TIMEOUT_MS)
          timer.unref()
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
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
      // Cancel any pending long-press for this key — release wins.
      const t = this.holdTimers.get(id)
      if (t) { clearTimeout(t); this.holdTimers.delete(id) }
      this.emit('press', { kind: 'up', control: this.byHidId.get(id)! })
    }
    for (const id of now) if (!prev.has(id)) {
      prev.add(id)
      const control = this.byHidId.get(id)!
      this.emit('press', { kind: 'down', control })
      // Arm a long-press; if 'up' arrives first, the timer is cleared above.
      const timer = setTimeout(() => {
        this.holdTimers.delete(id)
        this.emit('press', { kind: 'long-press', control })
      }, LONG_PRESS_MS)
      this.holdTimers.set(id, timer)
    }
  }
}
