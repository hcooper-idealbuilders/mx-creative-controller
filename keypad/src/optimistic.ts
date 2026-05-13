// Apply an optimistic local state update on a keypad button press, so the
// LCDs reflect the user's action immediately instead of waiting for Claude
// Code to fire its next hook event (which may be many seconds away — Approve
// in particular doesn't have a follow-up event until Claude finishes or asks
// again).
//
// The next real `{ type: 'sessions' }` broadcast from the sidecar always
// supersedes this, so it's safe — worst case it's right for a moment and
// then corrected.
import type { SessionStatus, Command } from './state.js'

export function applyOptimisticUpdate(
  sessions: ReadonlyArray<SessionStatus>,
  sessionId: string,
  command: Command,
): SessionStatus[] {
  // continue / resume both put Claude back to work — flip to thinking
  if (command === 'continue' || command === 'resume') {
    return sessions.map((s) =>
      s.session_id === sessionId
        ? { ...s, state: 'thinking', last_event: `optimistic:${command}` }
        : s,
    )
  }
  // dismiss removes the session locally; sidecar will confirm via file deletion
  if (command === 'dismiss') {
    return sessions.filter((s) => s.session_id !== sessionId)
  }
  // focus doesn't change state
  return sessions.slice()
}
