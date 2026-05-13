# mx-creative-controller

A hardware controller for [Claude Code](https://claude.com/claude-code) built on top of the Logitech MX Creative Console. Live status from up to three concurrent Claude sessions across the keypad, plus hardware buttons for Continue / Approve / Focus / Resume / Dismiss — all working *while Logi Options+ is still running and managing the dialpad*.

This repo is also the public journal of getting there — including the dead ends. See [`docs/journal/`](docs/journal/) for the story.

## Layout

```
                       ╔═══════════╤═══════════╤═══════════╗
row 0 — status         ║   ✦ S₀    │   ✦ S₁    │   ✦ S₂    ║
row 1 — primary        ║ Continue  │ Continue  │ Continue  ║
row 2 — secondary      ║   Focus   │   Focus   │   Focus   ║
                       ╚═══════════╧═══════════╧═══════════╝
```

Each column is one Claude session, assigned FIFO. The status mark in row 0 is tinted by session state:

| State           | Mark                   | Trigger |
|-----------------|------------------------|---------|
| `idle`          | gray Claude mark       | SessionStart |
| `thinking`      | **two pulsing dots**   | UserPromptSubmit |
| `waiting_input` | orange Claude mark     | Notification |
| `done`          | green Claude mark      | Stop |
| `ended`         | red Claude mark        | SessionEnd |

Row 1 / row 2 labels swap with state:

- alive: `Continue` (smart — sends `y⏎` on `waiting_input`, otherwise `continue⏎`) / `Focus`
- ended: `Resume` (sends `/resume⏎`) / `Dismiss` (frees the column)

## Architecture

```
Claude Code (PowerShell)
  └─ hooks  SessionStart / UserPromptSubmit / Stop / Notification / SessionEnd
       └─ per-session JSON in  ~/.claude/mx-sessions/<session_id>.json
                       │
                       ▼  (fs.watch on the directory)
                 sidecar/  (Node, TypeScript)
                  ├─ WebSocket server  ws://127.0.0.1:9876
                  │     broadcasts { type: "sessions", sessions: [...] }
                  └─ keystroke sender → PowerShell SendKeys → Claude window
                       ▲
                       │
                  keypad/  (Node, TypeScript)
                  ├─ paints 9 LCDs per session state (Canvas + JPEG)
                  ├─ reads button presses, dispatches by column
                  └─ 1Hz refresh reclaims from Logi Options+ on app-focus changes
                       │
                       ▼
              MX Creative Console keypad
```

## Install (Windows)

Prereqs: **Logi Options+** (for the device drivers), **Node 22+** (the unofficial HID lib needs prebuilt binaries — Node 24 also works).

```powershell
# Clone
git clone https://github.com/hcooper-idealbuilders/mx-creative-controller.git
cd mx-creative-controller

# Merge settings/claude-hooks.json into ~/.claude/settings.json
#   (open both files, copy the "hooks" block over — or use the
#    update-config Claude Code skill to merge for you)

# Install + register both services as Windows Scheduled Tasks
.\install.ps1                # builds, registers; auto-start on next logon
.\install.ps1 -StartNow      # also kill any dev processes and start now
```

The installer:
- Self-elevates via UAC.
- Runs `npm install && npm run build` for `sidecar/` and `keypad/`.
- Registers two Scheduled Tasks (`mx-sidecar` and `mx-keypad`) that start at user logon, restart on failure, and run hidden.
- Logs to `logs/sidecar.log` and `logs/keypad.log`.

To uninstall: `.\uninstall.ps1` (stops + unregisters the tasks; leaves source/build/logs in place).

## Try it

After install:
1. Start any Claude Code session in PowerShell. Watch column 0 light up with your project name.
2. Submit a prompt — column 0's mark turns into two pulsing dots.
3. When Claude finishes — green mark + the `Continue` and `Focus` buttons light up.
4. Open a second Claude Code in another terminal — it appears in column 1.

## Repo map

- `sidecar/` — Node service. Watches `~/.claude/mx-sessions/`, exposes WebSocket, sends keystrokes.
- `keypad/` — Node service. Drives the LCDs (Col03), reads button events (Col01/Col02), dispatches commands.
- `hooks/update-status.ps1` — Claude Code hook script.
- `settings/claude-hooks.json` — hook config snippet to merge into `~/.claude/settings.json`.
- `install.ps1` / `uninstall.ps1` — Scheduled-Task installer.
- `experiments/` — diagnostic scripts written during reverse-engineering. See `experiments/README.md`.
- `captures/` — USB packet captures + derived data. See `captures/README.md`.
- `docs/` — `protocol.md`, `architecture.md`, and the dated session `journal/`.
- `plugin/` — the dead-end Logi Actions SDK attempt. Kept as narrative context.

## The discovery worth sharing

If you hit `Cannot write to hid device` with `@logitech-mx-creative-console/node`, the lib opens the wrong HID collection by default. The MX Creative Console exposes report IDs `0x11` / `0x13` / `0x14` on **three separate HID collections** (`Col01` / `Col02` / `Col03`, vendor page `0xff43`, usages `0x1a02` / `0x1a08` / `0x1a10`). The lib only opens one handle, so it always fails on at least one report type. See [`docs/protocol.md`](docs/protocol.md) and the journal for the full story.
