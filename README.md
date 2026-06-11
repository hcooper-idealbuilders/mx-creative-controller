# mx-creative-controller

A hardware controller for [Claude Code](https://claude.com/claude-code) built on top of the Logitech MX Creative Console. Live status from up to three concurrent Claude sessions across the keypad, plus hardware buttons for Approve and Focus — all working *while Logi Options+ is still running and managing the dialpad*.

This repo is also the public journal of getting there — including the dead ends. See [`docs/journal/`](docs/journal/) for the story.

## Layout

```
                       ╔═══════════╤═══════════╤═══════════╗
row 0 — status         ║   ✦ S₀    │   ✦ S₁    │   ✦ S₂    ║
row 1 — primary        ║  Approve  │  Approve  │  Approve  ║
row 2 — secondary      ║   Focus   │   Focus   │   Focus   ║
                       ╚═══════════╧═══════════╧═══════════╝
```

Each column is one Claude session, assigned FIFO. Empty columns render rainbow Claude-mark screensaver tiles. The status mark in row 0 is tinted by session state:

| State           | Mark                   | Trigger |
|-----------------|------------------------|---------|
| `idle`          | green Claude mark      | SessionStart |
| `thinking`      | **two pulsing dots**   | UserPromptSubmit / PreToolUse |
| `waiting_input` | orange Claude mark     | Notification |
| `done`          | green Claude mark      | Stop |

SessionEnd deletes the session file outright — ended sessions don't display.

- **row 0 (status)** — tap cycles per-session effort level (low → medium → high → xhigh) via `/effort`; long-press toggles fast mode via `/fast`.
- **row 1 (Approve)** — enabled only on `waiting_input` *and* when the notification text matches a known permission-prompt pattern (e.g. `"Claude needs your permission"`). Direction-change questions leave the button greyed so an accidental press can't steer the work off course. Approve sends `1⏎` (Claude Code's numbered "Yes" option).
- **row 2 (Focus)** — focuses the terminal hosting that session.

## Architecture

```
Claude Code (PowerShell)
  └─ hooks  SessionStart / UserPromptSubmit / PreToolUse / PostToolUse
            / Notification / Stop / SessionEnd
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
3. When Claude asks for permission — the mark turns orange and `Approve` lights green. One press answers it.
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

## The discoveries worth sharing

**Three HID collections, not one.** If you hit `Cannot write to hid device` with `@logitech-mx-creative-console/node`, the lib opens the wrong HID collection by default. The MX Creative Console exposes report IDs `0x11` / `0x13` / `0x14` on **three separate HID collections** (`Col01` / `Col02` / `Col03`, vendor page `0xff43`, usages `0x1a02` / `0x1a08` / `0x1a10`). The lib only opens one handle, so it always fails on at least one report type. See [`docs/protocol.md`](docs/protocol.md) and the journal for the full story.

**The firmware dims the panels on its own.** After an idle period (and after USB suspend), the console sets its LCD brightness to zero all by itself. Image writes keep succeeding — into a black screen. If your keypad "works perfectly" with nothing visible, send the HID++ brightness command (`0x11 ff 0f 2b 00 <pct>` on Col01) periodically. This controller re-asserts it every 30 seconds.

**Windows Terminal eats console windows.** With WT as the default terminal app, any console process you spawn becomes a WT *tab* and never owns a window handle — `MainWindowHandle` stays 0 forever. Spawn via `conhost.exe <your.exe>` when you need a targetable window (our e2e harness does). Relatedly: one WT process owns *many* top-level windows, so never treat `MainWindowHandle` equality as a window-validity test.
