// Pure decision functions used by the renderer.
// Extracted so we can unit-test "Approve vs Continue", "Resume vs Dismiss",
// etc. without spinning up @napi-rs/canvas.
import type { SessionState } from './state.js'
import { isPermissionPrompt } from './notification.js'

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
 * Secondary (Focus) is always meaningful when a session exists.
 *
 * Primary (Approve) is gated more strictly than state alone — Claude fires
 * Notification for both "permission to use Bash?" (safe to approve) and
 * "want to refactor X instead?" (a direction-change disguised as a question).
 * Approving the latter blindly would steer the work off course, so we
 * require notificationMessage to positively match a known permission-prompt
 * pattern. Unknown phrasing → disabled (safety default).
 */
export function isActionEnabled(
  state: SessionState | null,
  role: ActionRole,
  notificationMessage?: string | null,
): boolean {
  if (state === null) return false
  if (role === 'secondary') return true
  if (state !== 'waiting_input') return false
  return isPermissionPrompt(notificationMessage)
}
