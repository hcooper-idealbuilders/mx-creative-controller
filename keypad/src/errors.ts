// Track recent command failures per session so the keypad can flash an
// error indicator when a press didn't reach Claude. We only need the
// timestamp of the most recent failure — the command and error message
// already go to stderr via the caller.

/** True if the session has an error recorded within the last `windowMs`. */
export function hasRecentError(
  sessionId: string,
  errors: ReadonlyMap<string, number>,
  now: number,
  windowMs: number,
): boolean {
  const at = errors.get(sessionId)
  return at !== undefined && now - at < windowMs
}

/** Add or update the error record for a session. Returns a fresh Map (immutable). */
export function recordError(
  errors: ReadonlyMap<string, number>,
  sessionId: string,
  at: number,
): Map<string, number> {
  const next = new Map(errors)
  next.set(sessionId, at)
  return next
}

/** Drop expired entries. Useful for periodic cleanup so the map doesn't grow. */
export function pruneErrors(
  errors: ReadonlyMap<string, number>,
  now: number,
  windowMs: number,
): Map<string, number> {
  const next = new Map<string, number>()
  for (const [id, at] of errors) {
    if (now - at < windowMs) next.set(id, at)
  }
  return next
}
