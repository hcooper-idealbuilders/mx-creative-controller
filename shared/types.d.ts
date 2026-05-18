// Single source of truth for the wire-protocol types shared between
// `sidecar/` (producer — watches the per-session JSON, broadcasts over
// WebSocket) and `keypad/` (consumer — paints LCDs, dispatches presses).
//
// Both packages `import type { … } from '../../shared/types.js'`. Because
// these are type-only imports, tsc strips them at compile time — there is
// no runtime file at the shared/ path and no need to compile this file
// into either package's dist. The single declaration is what stops the
// two sides from silently drifting (which the audit on 2026-05-15 flagged
// as the main durability risk).

/**
 * High-level state of a Claude Code session, as observed via hooks.
 *   idle          — session started, no prompt submitted yet
 *   thinking      — Claude is generating a response or running a tool
 *   waiting_input — Claude fired a Notification (permission prompt or
 *                   open-ended question); see notification_message
 *   done          — Stop hook fired; Claude finished and isn't waiting
 *
 * SessionEnd doesn't get its own state because the hook deletes the file
 * outright — ended sessions don't display.
 */
export type SessionState = 'idle' | 'thinking' | 'done' | 'waiting_input'

/**
 * The full per-session payload written by `hooks/update-status.ps1` and
 * broadcast verbatim by the sidecar. Adding a field here is the right
 * place to do it — both packages pick it up automatically.
 */
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
  /**
   * Verbatim Notification payload message (null on non-Notification events).
   * Gates Approve so it only enables when the prompt looks like a permission
   * request for the current task, not an open-ended direction-change question.
   */
  notification_message: string | null
}
