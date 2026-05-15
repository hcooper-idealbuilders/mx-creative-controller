// Pure decision functions used by the renderer.
// Extracted so we can unit-test "Approve vs Continue", "Resume vs Dismiss",
// etc. without spinning up @napi-rs/canvas.
import type { SessionState } from './state.js'

export type ActionRole = 'primary' | 'secondary'

/** Label shown on the row-1 or row-2 button for a given session state. */
export function actionLabel(state: SessionState | null, role: ActionRole): string {
  if (state === null) return ''
  if (role === 'primary') return state === 'waiting_input' ? 'Approve' : 'Continue'
  return 'Focus'
}

/** Background hex for the row-1 or row-2 button for a given session state. */
export function actionBg(state: SessionState | null, role: ActionRole): string {
  if (state === null) return '#0a0a0a'
  if (role === 'primary') return state === 'waiting_input' ? '#1f6f3a' : '#3a3a3a'
  return '#1f4a7a'
}

/**
 * Whether the action button does something meaningful in the given state.
 * When false, the keypad dims the button and ignores presses.
 *
 * The keypad's job is to handle moments when Claude actually needs you —
 * not to type arbitrary prompts. So primary is enabled only when
 * waiting_input (→ Approve).
 *
 * Secondary (Focus) is always meaningful when a session exists.
 */
export function isActionEnabled(state: SessionState | null, role: ActionRole): boolean {
  if (state === null) return false
  if (role === 'secondary') return true
  return state === 'waiting_input'
}
