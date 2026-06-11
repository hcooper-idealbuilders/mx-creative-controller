# Experiments

Diagnostic scripts written during reverse-engineering. Chronological:

| Script | What it does | Outcome |
|---|---|---|
| `test.mjs` | First smoke test against `@logitech-mx-creative-console/node`. Lists devices, opens, attempts `clearPanel()` then `fillKeyColor`. | Device detected (`mx-creative-keypad`), opens cleanly, but `clearPanel` fails with `Cannot write to hid device`. |
| `probe-paths.mjs` | Probes each of the 5 HID interfaces (Col01–Col05) using the official lib's `openMxCreativeConsole`. Tries a clearPanel + fillKeyColor on each. | All 5 fail. Looked terminal at this point. |
| `replay-hid.mjs` | **The breakthrough.** Replays the captured LCD-write payload (`captures/derived/frame521.hex`) via raw `node-hid` to each of the 5 HID paths, bypassing the lib's wrappers. | Col03 (vendor page `0xff43`, usage `0x1a10`) accepted the write. Others rejected. |
| `correct-path-test.mjs` | Tried passing the Col03 path to the official lib's `openMxCreativeConsole`. | Fails: the lib's two uncommented init writes (report ID `0x11`) belong on Col01, not Col03. Confirms the lib needs two HID handles. |
| `replay-all.mjs` | Replays all 5 captured LCD-write packets to Col03 in sequence. | LCDs visibly changed for ~500ms before reverting. |
| `replay-loop.mjs` | Out-paint test: spam captured panel writes for 10s at 10Hz. | Logi logo flickered between our writes. The firmware refresh asserts itself faster than we can dominate. |
| `replay-with-claim.mjs` | Heartbeat (`11ff041d0bb8...`) at 1Hz on Col01 + LCD writes on Col03. | Volume icon stayed gone (Options+'s claim was successfully evicted) but the device kept reverting to its built-in Logi logo. Heartbeat alone is not the full claim. |

## Setup

```sh
npm install
```

Most scripts use the installed `@logitech-mx-creative-console/node` and `node-hid`. Read paths to `../captures/derived/` for the captured payloads.

## Capture scripts

`scripts/*.bat` are USBPcap orchestration wrappers — they must be launched elevated. See `captures/README.md`. (They predate the repo's move and still reference the old working-directory paths; kept as-is for the historical record.)

## Live diagnostics (current)

Unlike the historical scripts above, these two are part of the working toolchain:

| Script | What it does |
|---|---|
| `scripts/ws-monitor.mjs` | Connects to the sidecar WebSocket and appends every broadcast to `logs/ws-monitor.log` — shows exactly what the keypad receives, and when, without staring at LCDs. |
| `scripts/e2e-test.ps1` | Full-pipeline test against a sandboxed conhost window: fake session file → watcher → broadcast → approve/effort/fast/focus commands → real SendKeys delivery, verified. 12 checks. Run after any sidecar or send-keys change. |
