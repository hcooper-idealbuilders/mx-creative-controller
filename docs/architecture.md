# Architecture

## Overall flow

```
   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
   │ Claude Code #1 │  │ Claude Code #2 │  │ Claude Code #3 │   (any terminal)
   └────────────────┘  └────────────────┘  └────────────────┘
           │ hooks: SessionStart / UserPromptSubmit / PreToolUse /
           │        PostToolUse / Notification / Stop / SessionEnd
           ▼
   hooks/update-status.ps1
     - one JSON file per session: ~/.claude/mx-sessions/<session_id>.json
     - atomic swap (ReplaceFile w/ retries) so readers never see a gap
     - captures the terminal window per session (foreground at prompt
       submit → title match → single-window fallback), cached across fires
           │
           ▼  fs.watch + 30s liveness poll
   ┌─────────────────────────────────────────────┐
   │  sidecar/  (Node, TypeScript)               │
   │  - SessionsWatcher: serialized reloads,     │
   │      read retries, 800ms missing-grace,     │
   │      prunes sessions whose PID died         │
   │  - WebSocket server 127.0.0.1:9876          │
   │      broadcasts { type:'sessions', [...] }  │
   │  - routing: command + state → keystroke     │
   │  - keystroke sender → send-keys.ps1         │
   │      focus → verify (3-stage escalation) →  │
   │      type → restore prior foreground        │
   └─────────────────────────────────────────────┘
           ▲ ws            │ broadcasts
           │ commands      ▼
   ┌─────────────────────────────────────────────┐
   │  keypad/  (Node, TypeScript)                │
   │  - 3 HID handles (Col01/Col02/Col03)        │
   │  - paints 9 LCDs per session state          │
   │  - brightness keepalive every 30s           │
   │  - write timeout → disconnect → reconnect   │
   │  - press dispatch by column, remap lockout  │
   └─────────────────────────────────────────────┘
           │
           ▼
   MX Creative Console keypad
```

## Per-session status JSON

Written by `hooks/update-status.ps1`, one file per session at
`~/.claude/mx-sessions/<session_id>.json`, UTF-8 **without BOM**
(PowerShell's default `Set-Content -Encoding UTF8` writes a BOM that breaks
`JSON.parse`). Swapped into place with `[System.IO.File]::Replace` —
`Move-Item -Force` is delete-then-rename on Windows and gave the watcher an
ENOENT window.

```json
{
  "state": "idle | thinking | done | waiting_input",
  "project": "hardware-interface",
  "model": "claude-fable-5[1m]",
  "fast_mode": false,
  "session_id": "...",
  "claude_code_pid": 24456,
  "claude_pid": 28748,
  "claude_hwnd": 202290,
  "first_seen": "2026-06-10T13:46:00Z",
  "last_event": "Notification",
  "last_updated": "2026-06-10T14:36:17Z",
  "notification_message": "Claude needs your permission"
}
```

- `claude_code_pid` — Claude Code's own process, found by walking the hook's
  parent chain. Used by the sidecar for liveness pruning (a killed terminal
  never fires SessionEnd).
- `claude_pid` / `claude_hwnd` — the terminal **window** hosting the session.
  Windows Terminal hosts shells over ConPTY, so the window owner is *not* in
  the hook's parent chain; instead the hook grabs the foreground window at
  `UserPromptSubmit` (the one moment the user is provably typing in this
  session), falling back to title match, then single-terminal-window. One WT
  process can own many windows, so per-session hwnds matter and
  `MainWindowHandle` equality cannot be used as a validity check.
- `notification_message` — lets the keypad distinguish permission prompts
  (Approve enabled) from open-ended questions (Approve greyed; see
  `keypad/src/notification.ts`).

State machine: `SessionStart`→idle, `UserPromptSubmit`→thinking,
`PreToolUse`/`PostToolUse`→thinking, `Notification`→waiting_input,
`Stop`→done. `SessionEnd` deletes the file.

## Sidecar

`sidecar/src/`:
- `index.ts` — wires the pieces; after a delivered approve it writes
  `state: thinking` into the session file itself (no hook fires until the
  approved tool *finishes*, and stale `waiting_input` would re-light Approve
  and invite double-presses).
- `sessions-watcher.ts` — per-session files → FIFO-ordered session list.
  Reloads are serialized and coalesced; reads retry through transient
  failures; sessions missing from a read survive 800ms before being dropped.
- `routing.ts` — pure `(command, state) → keystroke` mapping.
- `ipc-server.ts` — WebSocket on `127.0.0.1:9876`. Broadcasts
  `{type:'sessions'}` on change and `{type:'command-result'}` after sends.
- `keystroke-sender.ts` / `scripts/send-keys.ps1` — focuses the target
  window with a 3-stage escalation (AttachThreadInput trick → synthetic ALT
  tap → minimize/restore bounce), **verifies focus landed** before typing
  (otherwise the keys would go to whatever IS foreground), types via
  SendKeys, restores the prior foreground. Every press logs to
  `logs/send-keys.log` with the focus outcome.

## Keypad

`keypad/src/`:
- `device.ts` — three `node-hid` handles (Col01/Col02/Col03), writes routed
  by report ID. Writes carry a 2s timeout; a hung or failed write tears down
  to the reconnect path (a wedged handle once froze painting silently).
  `open()` is exception-safe (a partial open used to leak handles that
  blocked every reopen). Brightness (HID++ `0x11 ff 0f 2b`, col1) is
  asserted at open and every 30s — the firmware dims the panels to black on
  its own idle timer while writes keep "succeeding".
- `index.ts` — paints per the latest broadcast (1Hz idle / 200ms animating),
  dispatches presses by column, applies optimistic state overlays, plays the
  startup flurry as a 9-key self-test, and ignores presses for 400ms after
  any column remap (a session ending shifts later columns left — a press
  aimed at the old layout would hit a different session).
- `notification.ts` — conservative allowlist of permission-prompt phrasings;
  unknown phrasing leaves Approve disabled by design.

## Services

Both services run as Scheduled Tasks (`mx-sidecar`, `mx-keypad`) via
wscript→powershell launchers. The launchers keep PID files and kill their
previous node child on start — `Stop-ScheduledTask` only kills the wrapper,
which used to stack duplicate processes fighting over the port / HID device.

## Verification

`experiments/scripts/e2e-test.ps1` drives the full pipeline (session file →
watcher → broadcast → command → focus steal → real keystrokes) against a
sandboxed conhost window: approve/effort/fast/focus delivery, post-approve
state hold, double-press guard, focus verification. 12 checks; run it after
any sidecar or send-keys change. `experiments/scripts/ws-monitor.mjs` tails
live broadcasts to `logs/ws-monitor.log`.
