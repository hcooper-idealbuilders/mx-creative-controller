# 2026-05-13 — From the official SDK to the Col03 breakthrough

How we went from "let's just install a plugin" to USB-sniffing the MX Creative Console at 4am.

## The goal

A hardware feedback loop with Claude Code: know when it's done thinking, respond from the keypad without focus-stealing the terminal. Status indicator on the LCDs (project, model, state dot), a few response keys (Continue / Yes / No / Interrupt).

## Path A: the official Logi Actions SDK

Started where you'd start: install Logi Options+, install the Logi Plugin Tool (`npx @logitech/plugin-toolkit create ...`), scaffold a plugin, register some `CommandAction`s, ship.

Then we read the actual SDK types. `@logitech/plugin-sdk` v0.1.1 (released spring 2026) exposes:

```ts
ActionType.None = 0
ActionType.Command = 1
class CommandAction { onKeyDown(): void | Promise<void> }
class AdjustmentAction { execute(event): void }   // rotary
```

That's it. **No dynamic-icon API.** No `setImage`, no render callback, no state push. Icons are static SVGs declared at build time in `package/actionicons/<name>.svg`. The Loupedeck-era SDK had bitmap pushing; the rebooted Actions SDK hasn't shipped it yet.

So "green dot when Claude is done" isn't doable through the official path. The scaffold sits at `plugin/` as a tombstone.

## Path B: the unofficial HID library

Julian Waller (Bitfocus Companion) ships `@logitech-mx-creative-console/node` (v0.3.0 yesterday). Promises direct HID access — exactly what we want.

```sh
npm install @logitech-mx-creative-console/node    # node 24, prebuilt binary worked
node -e "..."   # devices found, opened as 'mx-creative-keypad'
```

Then:

```
Col01  open… ok  clearPanel…  →  Cannot write to hid device
Col02  open…  →  Cannot write to hid device
Col03  open…  →  Cannot write to hid device
Col04  open…  →  Cannot write to hid device
Col05  open…  →  Cannot write to hid device
```

All five HID interfaces (the device exposes 5 collections) refuse writes. Same with the agent killed, the appbroker killed, running as admin. Library issue #11 proves writes *do* work for someone — but not here. We almost called it dead.

## USB sniff

Wireshark 4.6.5 (which dropped USBPcap integration — install USBPcap separately from desowin.org). USBPcapCMD needs admin to capture. Twenty seconds of capture while Options+ paints a freshly-assigned binding.

Frame 521, at offset 0x30 inside a 4095-byte interrupt-OUT packet on endpoint 1:

```
ff d8 ff e0 00 10 4a 46 49 46 ...
^^^^^                           ^^^^^^^^^^^^
SOI                             "JFIF"
```

**Plain JPEG.** No encryption. No signing. The MX Creative Console renders its LCDs from straight JPEG data sent over USB interrupt OUT, prefixed with a 20-byte HID header (`14 ff 02 2d e0 01 00 01 00 00 17 00 06 01 b3 01 b2 00 05 b4`). Report ID is **`0x14`**.

So the question wasn't "can we write" — it was "where do we write."

## The Col03 fix

Walked the 5 HID collections again with the captured payload as the test write. Three of the five immediately rejected. Col01 accepted the *initial* write but later panel writes failed. **Col03 accepted everything.** Same payload, same node-hid, same binary — only the destination collection differed.

```
Col01 (usage=0x1a02, usagePage=0xff43)             ✗ Cannot write to hid device
Col02 (usage=0x1a08, usagePage=0xff43)             ✗ Cannot write to hid device
Col03 (usage=0x1a10, usagePage=0xff43)             ✓ WROTE 4095 bytes
Col04 (usage=0x80,   usagePage=0x1)                ✗ Cannot write to hid device
Col05 (usage=0x1,    usagePage=0xc)                ✗ Cannot write to hid device
```

`@logitech-mx-creative-console/node`'s `listMXCreativeConsoleDevices()` returns all five paths; `openMxCreativeConsole` opens whichever is first (Col01 on our hardware). The lib's keypad model has two uncommented init writes that begin with report ID `0x11` — those need a HID++ collection (Col01). The LCD writes use report ID `0x14` — those need Col03. The lib uses one handle, so one of them always fails.

This is fixable upstream (open both collections, route writes by report ID), but for now we open Col03 ourselves with raw `node-hid`.

## The next wall

Wrote the captured frame to Col03 with Options+ running:

> "the volume icon disappeared and now its back"

Our paint rendered. Then Options+ overwrote within ~500ms.

Killed the agent. Killed the appbroker (UAC). Killed `LogiPluginService` and `LogiPluginServiceExt`. Killed all five `logioptionsplus.exe` instances. Stopped `OptionsPlusUpdaterService`. Zero Logi processes left. Tried again.

> "the logi icon was flashing during the loop test"

The Logi logo is what the **firmware** defaults to when no host is actively claiming the display. Our writes paint pixels for a beat; the firmware reasserts its default. The device's own state machine is the new wall.

We caught the steady-state heartbeat at 1Hz:

```
11 ff 04 1d 0b b8 00 00 ...     // every ~1s on endpoint 1, exactly identical
```

HID++ short report. Feature `0x04`, function `0x1`. Parameter `0x0bb8` = 3000ms — looks like "stay-active for 3 seconds." Replayed it on Col01 while painting Col03. The volume icon stayed gone (good — we evicted Options+'s claim) but the Logi logo flashed through our paints anyway. The heartbeat alone isn't a claim — it's a renew on something we haven't initiated.

Captured Options+ launching from cold. ~15 distinct HID++ commands in the first second — feature negotiations, root pings, button registration, multiple `0x13` (HID++ long) reports, and two `14ff022e...` LCD payloads. None of which we've decoded yet.

## Where we are

- ✅ LCDs are writable. No encryption, no signing, no "secure HID."
- ✅ The lib bug is identified (wrong default collection) and the workaround works.
- ✅ Options+ can be fully ejected from display ownership.
- ⚠️ The device's HID++ "claim the display" handshake is multi-command and we don't have it yet.

Next session: decode the startup capture's HID++ commands one at a time, find the minimum subset that gets the device to hold our writes.

[Captures live in `captures/`. Experiment scripts in `experiments/`. Protocol notes in `docs/protocol.md`.]
