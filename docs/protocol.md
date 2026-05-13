# MX Creative Console — protocol notes

Working reference for the device's USB/HID surface, as we figure it out. Updated per session.

USB IDs: **Vendor `0x046D` (Logitech)** / **Product `0xC354`** (MX Creative Keypad). The Console enumerates as a single USB device but exposes five HID collections.

## HID collections

Windows surfaces each collection as its own `\\?\HID#VID_046D&PID_C354&ColNN#...` path.

| Col | Usage Page | Usage | Purpose (so far) |
|---|---|---|---|
| Col01 | `0xff43` (vendor) | `0x1a02` | HID++ control. Accepts report IDs `0x11`, `0x13`. Init writes go here. |
| Col02 | `0xff43` (vendor) | `0x1a08` | Unknown — accepts neither tested report. |
| Col03 | `0xff43` (vendor) | `0x1a10` | **LCD image data.** Accepts report ID `0x14`. |
| Col04 | `0x01` (Generic Desktop) | `0x80` | System Control (sleep / wake / power). |
| Col05 | `0x0c` (Consumer) | `0x01` | Consumer Control (media keys). |

## Report ID 0x14 — LCD image data (Col03)

Sent on endpoint 1 (interrupt OUT). Each URB is up to 4095 bytes. A full panel paint we observed was 1 + 4 packets across two paint events.

Frame structure:

```
offset  bytes  meaning
0       1      report ID = 0x14
1       19     header (purpose-partly-known — see below)
20      ...    JPEG bitstream (starts with SOI ff d8 ff e0 + JFIF)
```

Captured header from one frame:

```
14 ff 02 2d e0 01 00 01 00 00 17 00 06 01 b3 01 b2 00 05 b4
```

Speculative decoding (unverified — to be confirmed by varying captures):
- `14` — report ID
- `ff` — device index / version?
- `02` — image type?
- `0x01b3` (435) / `0x01b2` (434) — dimensions? Panel is 480×480 per the lib's model file (`mx-creative-keypad.js`), so close but not exact.
- `0x05b4` (1460) — total payload length minus headers? JPEG is 4075 bytes after the 20-byte header here.

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

## Display claim — unknown

When all Logi software is killed, the device shows the **Logi logo** (firmware default). When Options+ runs, it paints/holds a profile icon (e.g., volume up). Our HID writes to Col03 succeed but the device reverts to its default ~500ms after each write unless something else is happening.

The 1Hz heartbeat (above) alone is **not** sufficient. The full claim is buried in the ~15 distinct HID++ commands Options+ sends during startup. Decoding this is the current research focus.

## Endpoints (from descriptor injection in capture)

- Endpoint 0 (control) — used for USB enumeration / SET_CONFIGURATION
- Endpoint 1 (interrupt OUT) — host → device data (LCD images, HID++ commands)
- Endpoint 1 (interrupt IN) — device → host data (input events, command responses)

## To-do

- Catalog every HID++ feature index used by Options+ at startup
- Identify the "display claim" feature (likely a `setHostMode` / `setDisplayOwner` command)
- Determine whether claim is a single command or a multi-step handshake
- Test minimum claim subset until paint sticks
- Document report 0x14 header bytes 11–19 by varying single-key vs. full-panel writes
