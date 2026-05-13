# MX Creative Console — protocol notes

Working reference for the device's USB/HID surface, as we figure it out. Updated per session.

USB IDs: **Vendor `0x046D` (Logitech)** / **Product `0xC354`** (MX Creative Keypad). The Console enumerates as a single USB device but exposes five HID collections.

## HID collections

Windows surfaces each collection as its own `\\?\HID#VID_046D&PID_C354&ColNN#...` path.

| Col | Usage Page | Usage | Purpose |
|---|---|---|---|
| Col01 | `0xff43` (vendor) | `0x1a02` | **HID++ short reports** (report ID `0x11`, 20 bytes). |
| Col02 | `0xff43` (vendor) | `0x1a08` | **HID++ long reports**  (report ID `0x13`, 32 bytes). |
| Col03 | `0xff43` (vendor) | `0x1a10` | **LCD image data**     (report ID `0x14`, up to 4095 bytes). |
| Col04 | `0x01` (Generic Desktop) | `0x80` | System Control (sleep / wake / power). |
| Col05 | `0x0c` (Consumer) | `0x01` | Consumer Control (media keys). |

`@logitech-mx-creative-console/node` opens only Col01 by default. Long-report HID++ writes and LCD writes need their own handles — that's the root cause of `Cannot write to hid device` errors.

## Report ID 0x14 — LCD image data (Col03)

Sent on endpoint 1 (interrupt OUT). Each URB is up to 4095 bytes. **This is a streaming/fragmented protocol** — images larger than one packet are split, and byte 4 indicates the fragment role.

Frame structure:

```
offset  bytes  meaning
0       1      report ID = 0x14
1       19     header (partly decoded — see below)
20      ...    payload (JPEG bitstream when present, starts with SOI ff d8)
```

Observed packet types (byte 4 = fragment marker):

| Marker | Example header | Behavior |
|---|---|---|
| `e0 01` | `14 ff 02 2d e0 01 00 01 00 00 17 00 06 01 b3 01 b2 00 05 b4` | Single-packet image — payload is a complete JPEG. Header bytes 18–19 = `05 b4` (1460) ≈ payload length minus padding. |
| `a0 01` | `14 ff 02 2d a0 01 00 01 00 00 17 00 06 01 b3 01 b2 00 11 0b` | Start of multi-fragment image. Header bytes 18–19 = `11 0b` (4363) — likely *total* image length. |
| `61 00` | `14 ff 02 2d 61 00 00 00 00 00 ...` | Finalize / end-of-image marker. Payload bytes after the small header look like the tail of the JPEG that didn't fit in the `a0 01` packet. |

So a full multi-packet image is `a0 01` (first chunk + header w/ total length) then `61 00` (rest of chunk + end marker). A single-packet image is just one `e0 01`.

**Byte 3** varies across captures (`0x2d` in one, `0x2e` in another). Likely a sequence/transaction counter that increments per paint event. Not yet confirmed.

**Bytes 10–17** (`17 00 06 01 b3 01 b2 00` in observed paints) — probably image geometry. `0x01b3` = 435 and `0x01b2` = 434 don't match the lib's claimed panel size of 480×480. Likely a cropped/inner region, or a different coordinate system. Needs more captures with single-key paints to nail down.

**What replay misses:** sending the 5 captured packets in sequence doesn't form a valid image stream — the second `a0 01` reuses sequence/transaction values that the device may treat as out-of-order. To make writes "stick," we need to *generate* valid `a0 01` / `61 00` sequences from scratch, with correct sequence counters and lengths. Reverse-engineering this is the current focus.

## Report ID 0x11 — HID++ short report (Col01)

20 bytes total. Standard Logitech HID++ 2.0 short report.

Steady-state heartbeat we observed at ~1Hz:

```
11 ff 04 1d 0b b8 00 00 ...
   ^^ ^^ ^^ ^^ ^^^^^
   |  |  |  |  parameter 0x0bb8 = 3000 (ms? "stay-active timer"?)
   |  |  |  └─ function 0x1, software_id 0xd
   |  |  └─ feature index 0x04 (unknown feature)
   |  └─ device index 0xff (self / broadcast)
   └─ report ID
```

Lib `mx-creative-keypad.js` has two uncommented init writes that register input notifications for the two non-LCD buttons (`hidId 0x01a1` and `0x01a2`):

```
11 ff 0b 3b 01 a1 03 00 00 00 00 00 00 00 00 00 00 00 00 00
11 ff 0b 3b 01 a2 03 00 00 00 00 00 00 00 00 00 00 00 00 00
```

So feature `0x0b` is likely "input event configuration."

## Report ID 0x13 — HID++ long report (Col01)

32 bytes total. Observed during startup but not steady state. Many distinct payloads in the startup capture — likely feature index negotiation and configuration.

## Display claim — partial

When all Logi software is killed, the device shows the **Logi logo** (firmware default). When Options+ runs, it paints and holds a profile icon. Our HID writes to Col03 succeed but the device reverts to a cached image ~500ms after each write unless we replicate Options+'s full ownership.

**What we've tried:**

| Test | Result |
|---|---|
| Heartbeat (`11ff041d0bb8...`) alone | Volume icon stays evicted but device reverts to Logi logo |
| Heartbeat + feature 0x04 fn=0 init | Same — still reverts |
| Full replay of 79 HID++ startup packets + heartbeat | Same — still reverts, but **0 write errors and 84+ device responses** (Col02 routing was the unlock) |
| Full handshake + 4 Hz LCD repaint + 1 Hz heartbeat | LCDs visibly flicker between our content and the firmware default |

**Where the gap is now:** the LCD-write protocol has fragment structure (`a0`/`61` markers, sequence counters in byte 3, total-length encoding). Our replay sends the captured packets verbatim, but the *second* `a0 01` reuses the same byte 3 as the first — the device probably treats the second image as malformed and reverts.

The next-session question: do we need a still-unknown HID++ "commit display" or "host owns display" command, or do we just need to construct correctly-sequenced `a0`/`61` LCD writes from scratch?

## Endpoints (from descriptor injection in capture)

- Endpoint 0 (control) — used for USB enumeration / SET_CONFIGURATION
- Endpoint 1 (interrupt OUT) — host → device data (LCD images, HID++ commands)
- Endpoint 1 (interrupt IN) — device → host data (input events, command responses)

## HID++ feature table (from startup capture)

Discovered via Root (`0x0000`) feature queries:

| Index | Feature ID | Name | Notes |
|---|---|---|---|
| 0x02 | 0x0003 | DeviceFwVersion | Many calls during startup — bootloader version, firmware build, etc. |
| 0x04 | **0x0008** | **proprietary keepalive** | The 1Hz heartbeat `11ff041d0bb8...` lives here. fn=0 returns `01 f4 27 10` (500ms / 10000ms timing?). fn=1 with param `0x0bb8` (3000ms) is the keepalive itself. The device also emits unsolicited notifications with sw_id `0xf` on this feature. |
| 0x06 | 0x00c3 | proprietary | Called twice with fn=0. Unknown purpose. |
| 0x07 | 0x1602 | proprietary | Discovered, not called. |
| 0x08 | 0x1802 | LedSwControl | Discovered, not called. |
| 0x0b | 0x1b04 | ReprogramControlsV4 | Called to register input notifications for the two non-LCD buttons (hidId `0x01a1`, `0x01a2`). |
| 0x0c | 0x1e00 | EnableHiddenFeatures | Discovered, not called in this capture. |
| 0x0d | 0x1e02 | EnableHiddenFeaturesV1 | Discovered, not called. |
| 0x0f | 0x8040 | proprietary | One call with param `00 46`. Unknown. |
| 0xc0 | 0xe019 | proprietary | High-index. Discovered, not directly called but referenced in a long-report response. |

## To-do (next session)

- Capture single-key paints (one color at a time) to decode the LCD-write geometry bytes (10–17).
- Figure out whether byte 3 is a transaction counter that must increment.
- Test whether constructing fresh `a0 01` + `61 00` sequences from arbitrary JPEG payloads sticks (vs. just replaying captured bytes).
- Investigate features `0x00c3`, `0x1602`, `0x8040`, `0xe019` — one of them may be the missing "host owns display" command.
- Once paint sticks, integrate with the sidecar to render real Claude state.
