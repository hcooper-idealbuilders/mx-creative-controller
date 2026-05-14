// Multi-session types + per-state colors for the keypad layout.

export type SessionState = 'idle' | 'thinking' | 'done' | 'waiting_input' | 'ended'

export interface SessionStatus {
  state: SessionState
  project: string | null
  model: string | null
  fast_mode: boolean
  session_id: string
  claude_pid: number | null
  /** Captured at hook time; preferred over claude_pid when targeting a window. */
  claude_hwnd: number | null
  first_seen: string | null
  last_event: string | null
  last_updated: string | null
}

// Commands sent from the keypad to the sidecar. The sidecar decides the
// actual keystroke (smart `continue` switches to `y⏎` when waiting_input).
export type Command = 'continue' | 'focus' | 'resume' | 'dismiss'

// Status-key background per state — solid color filling the whole key.
//   green  = Claude is not waiting on you (idle, done)
//   orange = Claude needs input          (waiting_input)
//   dark   = Claude is thinking          (just the pulsing dots)
//   red    = session ended               (ended)
export const STATE_BG: Record<SessionState, string> = {
  idle:          '#1f7a3a',
  thinking:      '#0a0a0a',
  waiting_input: '#cc7000',
  done:          '#1f7a3a',
  ended:         '#a02828',
}

// Claude-mark color per state — a darker shade of the background so the
// logo reads as a "tinted emboss" rather than a high-contrast icon.
export const STATE_COLOR: Record<SessionState, string> = {
  idle:          '#0e4f24',
  thinking:      '#cccccc', // unused — dots are drawn instead of a mark
  waiting_input: '#7a3c00',
  done:          '#0e4f24',
  ended:         '#5e1414',
}

export const KEYPAD_COLS = 3
export const KEYPAD_ROWS = 3
