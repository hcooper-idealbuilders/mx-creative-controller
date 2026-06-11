# The reliability gauntlet (June 10–11)

The repo moved (`~/Hardware-interface` → `~/IB/projects/hardware-interface`),
which broke nothing interesting — paths are paths. What the two days of
"why is it black / why is Approve grey / why did it type into bluebeam"
debugging actually surfaced was every reliability sin the v0.2 build had
been quietly committing. In rough order of discovery:

**Approve never lit.** Claude Code changed its notification text from
"Claude needs your permission to use Bash" to a bare "Claude needs your
permission". The conservative allowlist (correctly) refused to match, so the
button stayed grey on every genuine permission prompt. The allowlist
philosophy survives — observed phrasings only — with the new phrasing
observed and added.

**Sessions flickered out of broadcasts.** The hook wrote session files with
`Move-Item -Force`, which on Windows is delete-then-rename. The sidecar's
fs.watch reader kept catching the gap (`ENOENT` storms in the error log),
dropping that session from a broadcast, repainting the keypad without it,
then putting it back milliseconds later. Concurrent reloads could also
finish out of order, letting a stale read clobber a fresh one. Fixes:
`ReplaceFile` (atomic) with retries in the hook, serialized + coalesced
reloads with read retries in the watcher, and an 800ms missing-grace before
believing any session is really gone.

**Approve re-lit while Claude was working.** After a delivered approve, no
hook fires until the approved tool *finishes* — the session file says
`waiting_input` the whole time, which re-lit Approve and invited a
double-press (which then typed a stray `1⏎` somewhere real). The sidecar now
writes `state: thinking` into the session file the moment the keystroke is
delivered; hooks overwrite it the next time they fire. The first version of
that write lost a race (`EPERM` against the hook's own swap) — it retries
now.

**The window-targeting model was wrong.** Windows Terminal hosts shells via
ConPTY, so the terminal window is unreachable by walking the hook's parent
chain — and one WT process owns *many* top-level windows, so
`MainWindowHandle` is neither a resolver nor a validity test. The hook now
captures `GetForegroundWindow()` at `UserPromptSubmit` — the one moment the
user is provably typing in that session — with title-match and
single-window fallbacks.

**Focus steals silently failed.** Windows' foreground lock denies
`SetForegroundWindow` while the user types elsewhere; the old code's
verify-then-refuse correctly avoided typing into Excel, but "refuse" isn't a
fix. send-keys now escalates: AttachThreadInput trick → synthetic ALT tap
(exempts the caller from the lock) → minimize/restore bounce, verifying
after each.

**Three different ways to be black.** (1) A wedged HID write hung forever
and the repaint loop's guard flag never cleared — painting stopped silently.
Writes now carry a 2s timeout and any failure routes through the disconnect/
reconnect path. (2) A partial `open()` (device half-settled after USB
resume) leaked the already-opened collection handles, which then blocked
every reopen attempt — all night, silently, because `tryReopen()` swallowed
the error. Opens are exception-safe now and reopen failures are logged.
(3) The firmware itself dims the panels to zero on an idle timer, while
writes keep "succeeding". The brightness command (`0x11 ff 0f 2b` on Col01)
is now asserted at open and every 30 seconds. Each of these presented as
the same symptom: black keys, healthy logs.

**Restarts stacked duplicate processes.** `Stop-ScheduledTask` kills the
launcher wrapper but not the detached node child. Duplicate keypads fought
over the HID device; duplicate sidecars lost the port to their own
predecessor. The launchers now keep PID files and reap their previous
instance on start; uninstall does the same.

**Columns shift under your finger.** Sessions map to columns FIFO, so a
session ending shifts everything left — a press aimed at the old layout
lands on a different project's Approve. Presses are now ignored for 400ms
after any column remap.

The capstone is `experiments/scripts/e2e-test.ps1`: a fake session driven
through the real watcher, sidecar, focus-steal, and SendKeys into a
sandboxed conhost window (spawned via `conhost.exe` explicitly, because
with WT as the default terminal a bare console process becomes a tab and
never owns a window handle). Twelve checks cover the delivery paths, the
post-approve state hold, the double-press guard, and focus verification —
the regression gate this build should have had from the start.
