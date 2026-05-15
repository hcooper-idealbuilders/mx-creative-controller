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
  // continue (Approve) puts Claude back to work — flip to thinking
  if (command === 'continue') {
    return sessions.map((s) =>
      s.session_id === sessionId
        ? { ...s, state: 'thinking', last_event: 'optimistic:continue' }
        : s,
    )
  }
  // focus doesn't change state
  return sessions.slice()
}

/**
 * Merge an incoming `sessions` broadcast with the keypad's current local state,
 * honoring the optimistic-hold window so a fresh button-press isn't immediately
 * wiped out by a status broadcast that's already in flight.
 *
 * If a session was optimistically updated less than `holdMs` ago, we keep the
 * local copy of that session. Otherwise we accept the incoming version.
 */
export function mergeWithOptimistic(
  incoming: ReadonlyArray<SessionStatus>,
  local: ReadonlyArray<SessionStatus>,
  optimisticAt: ReadonlyMap<string, number>,
  now: number,
  holdMs: number,
): SessionStatus[] {
  return incoming.map((s) => {
    const lastOpt = optimisticAt.get(s.session_id) ?? 0
    if (now - lastOpt < holdMs) {
      const lcl = local.find((c) => c.session_id === s.session_id)
      if (lcl) return lcl
    }
    return s
  })
}
