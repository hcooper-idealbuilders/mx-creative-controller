// Shared types + layout constants for the keypad controller.

export type ClaudeState = 'idle' | 'thinking' | 'done' | 'waiting_input'

export interface Status {
  state: ClaudeState
  project: string | null
  model: string | null
  fast_mode: boolean
  session_id: string | null
  claude_pid: number | null
  last_event: string | null
  last_updated: string | null
}

export type Command = 'continue' | 'yes' | 'no' | 'interrupt' | 'focus'

// Per-state colors for the status indicator key.
export const STATE_COLOR: Record<ClaudeState | 'offline', string> = {
  idle:          '#555555',
  thinking:      '#ff9500',
  done:          '#34c759',
  waiting_input: '#ff3b30',
  offline:       '#222222',
}

// Action-key palette.
export const ACTION_BG = {
  continue:  '#3a3a3a',
  yes:       '#1f6f3a',
  no:        '#7a2727',
  interrupt: '#a04a00',
  focus:     '#1f4a7a',
  blank:     '#181818',
} as const

// 9-slot keypad layout (index 0 = top-left, 8 = bottom-right).
// Each slot is either a "status" indicator or a command action.
export interface KeySlot {
  kind: 'status' | 'action' | 'blank'
  label?: string
  command?: Command
  bg?: string
}

export const LAYOUT: KeySlot[] = [
  { kind: 'status' },
  { kind: 'action', label: 'Continue',  command: 'continue',  bg: ACTION_BG.continue  },
  { kind: 'action', label: 'Yes',       command: 'yes',       bg: ACTION_BG.yes       },
  { kind: 'action', label: 'No',        command: 'no',        bg: ACTION_BG.no        },
  { kind: 'action', label: 'Stop',      command: 'interrupt', bg: ACTION_BG.interrupt },
  { kind: 'action', label: 'Focus',     command: 'focus',     bg: ACTION_BG.focus     },
  { kind: 'blank' },
  { kind: 'blank' },
  { kind: 'blank' },
]
