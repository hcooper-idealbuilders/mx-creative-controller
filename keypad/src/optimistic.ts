// Optimistic state overlay for keypad presses.
//
// When the user presses a button, we want the LCD to show feedback
// immediately, before the keystroke has had time to fly through the
// sidecar → terminal → Claude → hook chain. We track a separate overlay
// map keyed by session_id; entries time out after `holdMs` and the real
// state shows through.
//
// Crucially we do NOT mutate the canonical `sessions` array — if the
// keystroke fails to actually reach Claude (no follow-up hook fires,
// no new broadcast arrives), the overlay still expires naturally on
// the next paint after holdMs. Old approach mutated `currentSessions`
// in place and could get stuck on the optimistic state forever.
import type { SessionStatus, SessionState } from './state.js'

export interface OptimisticEntry {
  state: SessionState
  at: number
}

/**
 * Combine real session state with the per-session optimistic overlays.
 * Fresh entries override; stale or absent entries fall through.
 */
export function getEffectiveSessions(
  real: ReadonlyArray<SessionStatus>,
  optimistic: ReadonlyMap<string, OptimisticEntry>,
  now: number,
  holdMs: number,
): SessionStatus[] {
  return real.map((s) => {
    const opt = optimistic.get(s.session_id)
    if (opt && now - opt.at < holdMs) {
      return { ...s, state: opt.state }
    }
    return s
  })
}

/** Drop optimistic entries that are older than the hold window. Pure. */
export function pruneOptimistic(
  optimistic: ReadonlyMap<string, OptimisticEntry>,
  now: number,
  holdMs: number,
): Map<string, OptimisticEntry> {
  const next = new Map<string, OptimisticEntry>()
  for (const [id, e] of optimistic) {
    if (now - e.at < holdMs) next.set(id, e)
  }
  return next
}
