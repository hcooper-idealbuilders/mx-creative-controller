# 2026-05-13 (later) — Col02 and the fragment protocol

After the first journal entry we kept going.

## What we wanted

Make our LCD paint *stick*. The earlier session proved Col03 writes land on the LCDs but get reverted after ~500ms unless we complete some claim that Options+ does at startup.

## The decoder

Built `experiments/decode-hidpp.mjs` — it walks the Root (`0x0000`) feature-discovery responses in the startup capture and reconstructs the device's feature table, then groups Options+'s host calls by feature. Output:

```
=== Feature table (index → ID, name) ===
  index 0x02  →  0x0003  DeviceFwVersion
  index 0x04  →  0x0008  unknown_0x0008     ← the heartbeat lives here
  index 0x06  →  0x00c3  unknown_0x00c3
  index 0x07  →  0x1602  unknown_0x1602
  index 0x08  →  0x1802  LedSwControl
  index 0x0b  →  0x1b04  ReprogramControlsV4
  index 0x0c  →  0x1e00  EnableHiddenFeatures
  index 0x0d  →  0x1e02  EnableHiddenFeaturesV1
  index 0x0f  →  0x8040  unknown_0x8040
  index 0xc0  →  0xe019  unknown_0xe019
```

So the heartbeat `11ff 04 1d 0bb8...` is feature `0x0008`, function `0x1`, parameter `0x0bb8` (3000ms). Function `0x0` of the same feature is called twice at startup with all-zero params — likely an initializer.

We tried calling fn=0 once before the heartbeat. The volume icon stayed gone (claim is real) but the device still reverted to the Logi logo. So fn=0 + heartbeat isn't the full claim.

## The full-replay experiment

`experiments/full-replay.mjs` reads all host-out HID++ packets from the startup capture and replays them in order. First run: blew up partway through with `Cannot write to hid device`.

The error pattern matched a hypothesis we'd already developed: **the lib only opens one HID collection, but the device exposes different report IDs on different collections.** We'd already seen this for the LCD writes (Col03). Now it was clear `0x13` (HID++ long, 32-byte) reports were equally homeless — `0x11` lives on Col01 but `0x13` lives on its own collection.

Opened Col02 (`0xff43:0x1a08`) explicitly and routed by report ID:
- `0x11` → Col01
- `0x13` → Col02
- `0x14` → Col03

Replay succeeded: **64 short + 15 long, 0 failures, 84+ device responses**. The device was *engaging* with us — sending back firmware version strings (`"BL2 "` for bootloader, `"U1f"` for user firmware), feature-table responses, the works.

## And it still reverted.

20 seconds of heartbeating after a clean handshake. Paint still snapped back. So replaying the captured commands isn't enough.

Tried one more variant: full handshake + 4Hz continuous LCD repaint + 1Hz heartbeat. Hunter watched: "it flickered/blinked." Our writes were landing, just being immediately overpainted by *something*.

## The LCD-write structure

We finally looked closely at the byte patterns of the captured LCD writes. There are three header types, marked by byte 4:

```
14 ff 02 2d  e0 01  ...   ← single small frame
14 ff 02 2d  a0 01  ...   ← start of multi-fragment image (bytes 18-19 = total length)
14 ff 02 2d  61 00  ...   ← finalize / end-of-image
```

The five "LCD writes" in the binding-paint capture aren't five frames of one image — they're **three logical paints**: one small single-shot, then two multi-fragment images (each an `a0 01` + `61 00` pair).

So when we naively replay all 5 packets we send something like `e0, a0, 61, a0, 61` — but byte 3 (`0x2d` for all of them, a likely transaction counter) is identical across all five. The device almost certainly treats those repeated transaction IDs as malformed and ignores most of them.

That explains the flickering: the first valid `e0 01` frame paints, then the next sequence is junk, the firmware reverts to its default, and we loop.

## So the missing piece is...

…either a "display claim" HID++ command we haven't identified, or — more likely — the requirement to *construct* valid LCD-write sequences from scratch with proper transaction counters and lengths, rather than replaying captured ones. We don't yet know which.

Next session: targeted captures of single-key paints to decode the geometry bytes (10–17) and confirm whether byte 3 is a counter that has to increment.

## Score

| | |
|---|---|
| ✅ | Decoded the device's HID++ feature table |
| ✅ | Found Col02 — the missing collection for HID++ long reports |
| ✅ | Got the device engaged in a full HID++ conversation (0 errors, 84+ responses) |
| ✅ | Identified the fragment structure (`a0`/`61`) inside LCD writes |
| ⚠️ | Display claim still partial — LCDs flicker but don't hold |
