# Architecture

## Overall flow

```
                ┌──────────────────────────────────────┐
                │ Claude Code session (PowerShell TUI) │
                └──────────────────────────────────────┘
                              │
                Hooks fire on lifecycle events:
                  SessionStart / UserPromptSubmit / Stop / Notification
                              │
                              ▼
              hooks/update-status.ps1
              (writes status JSON, no BOM, atomic rename)
                              │
                              ▼
              ~/.claude/mx-console-status.json
                              │
                       fs.watch (Node)
                              │
                              ▼
                ┌────────────────────────────┐
                │  sidecar/ (Node, TS)       │
                │                            │
                │  - StatusWatcher           │
                │  - WebSocket server :9876  │
                │  - KeystrokeSender         │
                │     └─ send-keys.ps1       │
                └────────────────────────────┘
                              ▲
                              │
                  ws://127.0.0.1:9876
                              │
                              ▼
              ┌──────────────────────────────┐
              │  Keypad controller [TBD]     │
              │                              │
              │  - Open HID Col01 (events,   │
              │      HID++ claim, heartbeat) │
              │  - Open HID Col03 (LCD       │
              │      images via report 0x14) │
              └──────────────────────────────┘
                              │
                              ▼
              MX Creative Console keypad
```

## Status JSON

Written by `hooks/update-status.ps1`. Lives at `~/.claude/mx-console-status.json`. UTF-8 **without BOM** (PowerShell's default `Set-Content -Encoding UTF8` writes a BOM that breaks `JSON.parse` — use `[System.IO.File]::WriteAllText` with a `UTF8Encoding($false)`).

```json
{
  "state": "idle | thinking | done | waiting_input",
  "project": "Hardware-interface",
  "model": "claude-opus-4-7",
  "fast_mode": false,
  "session_id": "...",
  "claude_pid": 12345,
  "last_event": "Stop",
  "last_updated": "2026-05-13T..."
}
```

Events:
- `SessionStart` → `idle` (also captures project from `cwd`, model from the hook payload, and Claude's PID via parent-of-parent walk)
- `UserPromptSubmit` → `thinking`
- `Stop` → `done`
- `Notification` → `waiting_input`

## Sidecar

`sidecar/src/`:
- `index.ts` — wires the pieces
- `status-watcher.ts` — `fs.watch` on the status file, emits parsed state. Strips UTF-8 BOM defensively.
- `ipc-server.ts` — WebSocket server on `127.0.0.1:9876`. Broadcasts state changes; receives `{ type: 'command', command: 'continue'|'yes'|'no'|'interrupt'|'focus' }` from connected clients.
- `keystroke-sender.ts` — spawns `scripts/send-keys.ps1` per command, which finds the Claude Code window (from `claude_pid` or foreground fallback), focuses it, sends keys via `System.Windows.Forms.SendKeys`.

Smoke client at `sidecar/smoke.mjs` connects to the WebSocket and prints state changes in real time — useful for verifying the back-half without hardware.

## Keypad controller (planned)

Two HID handles on the same physical USB device:
- **Col01** for HID++ traffic — claim the display, heartbeat to keep it claimed, receive button-press events.
- **Col03** for LCD image writes — JPEG-encoded panel images via report ID 0x14.

The image packing logic (panel layout, per-key sub-image extraction, JPEG encoding) is already implemented correctly in `@logitech-mx-creative-console/core`. We need to either:
1. Use the lib but inject a two-handle device wrapper that routes by report ID; or
2. Reimplement the small slice of packing we need directly against `node-hid`.

The actual blocker is the HID++ display-claim sequence — see `docs/protocol.md`.
