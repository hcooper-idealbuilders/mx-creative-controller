# mx-creative-controller

A custom hardware-feedback controller for [Claude Code](https://claude.com/claude-code), built on top of the Logitech MX Creative Console.

The goal: live status on the keypad LCDs (current project, model, "Claude is thinking", "Claude is done"), and hardware response keys that work even when the terminal isn't the focused window.

This repo is also the public journal of getting there — including the dead ends.

## Status

Work-in-progress.

| Half | State |
|---|---|
| **Sidecar** — Claude Code hooks → status JSON → Node WebSocket service → keystroke sender into PowerShell | ✅ Working end-to-end |
| **Keypad** — drive the LCDs and read key events from the MX Creative Console | ⚠️ Partial. We can paint pixels, but the device firmware reverts to a default after ~0.5s without a complete HID++ claim handshake we're still reverse-engineering. |

If you also got stuck on `Cannot write to hid device` with `@logitech-mx-creative-console/node`, see [`docs/journal/2026-05-13-from-sdk-to-col03.md`](docs/journal/2026-05-13-from-sdk-to-col03.md) — the lib opens the *wrong* HID collection by default. Writes succeed on Col03 (vendor page `0xff43`, usage `0x1a10`).

## Architecture

```
Claude Code (PowerShell)
  └─ hooks (SessionStart / UserPromptSubmit / Stop / Notification)
       └─ writes  ~/.claude/mx-console-status.json
                       │
                       ▼  (fs.watch)
                 sidecar/ (Node, TS)
                  ├─ WebSocket server  ws://127.0.0.1:9876
                  └─ keystroke sender → PowerShell SendKeys → Claude window
                       ▲
                       │
                  [keypad controller — TBD]
                       └─ MX Creative Console (LCDs + key events)
```

## Repo map

- `sidecar/` — Node service. Watches the status file, exposes WebSocket events, sends keystrokes to the Claude Code window.
- `hooks/` — PowerShell hook script. Claude Code invokes it on SessionStart / UserPromptSubmit / Stop / Notification.
- `settings/` — JSON snippet to merge into `~/.claude/settings.json`.
- `experiments/` — diagnostic scripts written during reverse-engineering. See `experiments/README.md`.
- `captures/` — USB packet captures (USBPcap pcap files) + derived data. See `captures/README.md`.
- `docs/` — protocol notes, architecture, and the dated session journal.
- `plugin/` — the dead-end Logi Actions SDK attempt. Kept for narrative context.

## Try the sidecar (Windows)

```sh
# 1. Wire the hooks into ~/.claude/settings.json
#    (or merge settings/claude-hooks.json manually)

# 2. Start the sidecar
cd sidecar
npm install
npm run dev

# 3. Start a Claude Code session in PowerShell
#    Watch ~/.claude/mx-console-status.json update as you chat.

# 4. (Optional) Watch live with the smoke client
node smoke.mjs
```

Hardware integration is gated on the protocol reverse-engineering — see the journal for the latest.

## The story

For the chronological writeup of how we got here, see [`docs/journal/`](docs/journal/).
