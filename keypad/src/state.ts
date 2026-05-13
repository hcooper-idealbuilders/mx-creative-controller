// Multi-session types + per-state colors for the keypad layout.

export type SessionState = 'idle' | 'thinking' | 'done' | 'waiting_input' | 'ended'

export interface SessionStatus {
  state: SessionState
  project: string | null
  model: string | null
  fast_mode: boolean
  session_id: string
  claude_pid: number | null
  first_seen: string | null
  last_event: string | null
  last_updated: string | null
}

// Commands sent from the keypad to the sidecar. The sidecar decides the
// actual keystroke (smart `continue` switches to `y⏎` when waiting_input).
export type Command = 'continue' | 'focus' | 'resume' | 'dismiss'

// Per-state color used to tint the Claude mark on the status key.
export const STATE_COLOR: Record<SessionState, string> = {
  idle:          '#888888',
  thinking:      '#cccccc', // mostly used for the dots; logo dimmed
  waiting_input: '#ff9500',
  done:          '#34c759',
  ended:         '#ff3b30',
}

export const KEYPAD_COLS = 3
export const KEYPAD_ROWS = 3
