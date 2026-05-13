// Track recent command failures per session so the keypad can flash an
// error indicator when a press didn't reach Claude.
import type { Command } from './state.js'

export interface CommandError {
  command: Command
  at: number          // Date.now() of the failure
  message?: string
}

/** True if the session has an error recorded within the last `windowMs`. */
export function hasRecentError(
  sessionId: string,
  errors: ReadonlyMap<string, CommandError>,
  now: number,
  windowMs: number,
): boolean {
  const e = errors.get(sessionId)
  return !!e && now - e.at < windowMs
}

/** Add or update the error record for a session. Returns a fresh Map (immutable). */
export function recordError(
  errors: ReadonlyMap<string, CommandError>,
  sessionId: string,
  command: Command,
  at: number,
  message?: string,
): Map<string, CommandError> {
  const next = new Map(errors)
  next.set(sessionId, { command, at, message })
  return next
}

/** Drop expired entries. Useful for periodic cleanup so the map doesn't grow. */
export function pruneErrors(
  errors: ReadonlyMap<string, CommandError>,
  now: number,
  windowMs: number,
): Map<string, CommandError> {
  const next = new Map<string, CommandError>()
  for (const [id, e] of errors) {
    if (now - e.at < windowMs) next.set(id, e)
  }
  return next
}
