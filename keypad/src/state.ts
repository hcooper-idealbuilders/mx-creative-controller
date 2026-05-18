// Multi-session types + per-state colors for the keypad layout.
//
// SessionState / SessionStatus live in `shared/types.ts` so the sidecar's
// producer side and this consumer side can't drift; we re-export them here
// so the rest of the keypad keeps importing from a single local module.

import type { SessionState, SessionStatus } from '../../shared/types'
export type { SessionState, SessionStatus }

// Commands sent from the keypad to the sidecar. The sidecar maps these to
// actual keystrokes:
//   continue + state=waiting_input → '1⏎' (Claude Code's numbered "Yes")
//   focus                          → focus window only
//   effort-<level>                 → /effort <level>⏎
export type Command =
  | 'continue'
  | 'focus'
  | 'effort-low'
  | 'effort-medium'
  | 'effort-high'
  | 'effort-xhigh'

// Status-key background per state — solid color filling the whole key.
//   green  = Claude is not waiting on you (idle, done)
//   orange = Claude needs input          (waiting_input)
//   dark   = Claude is thinking          (just the pulsing dots)
export const STATE_BG: Record<SessionState, string> = {
  idle:          '#1f7a3a',
  thinking:      '#0a0a0a',
  waiting_input: '#cc7000',
  done:          '#1f7a3a',
}
