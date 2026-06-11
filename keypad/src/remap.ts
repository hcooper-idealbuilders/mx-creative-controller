// Column-remap detection. Sessions are assigned to columns FIFO, so when a
// session ends (or is pruned), every later column shifts left. A press that
// was aimed at the old layout then lands on a *different session* — the
// worst kind of wrong: Approve meant for project A delivered to project B.
//
// The keypad uses this to impose a short press lockout after any remap,
// long enough for the human to notice the tiles changed.

/**
 * True when any column's session identity changed between two broadcasts.
 *
 * Pure appends (a new session filling a previously-empty trailing column)
 * are NOT a remap: presses on empty columns are no-ops, so there's nothing
 * mis-aimed to protect against — and locking out on every new session would
 * punish the common case.
 */
export function columnsRemapped(
  prev: ReadonlyArray<string | null>,
  next: ReadonlyArray<string | null>,
): boolean {
  for (let i = 0; i < Math.max(prev.length, next.length); i++) {
    const before = prev[i] ?? null
    const after = next[i] ?? null
    if (before === after) continue
    if (before === null) continue // append into an empty column — harmless
    return true                   // changed or vanished — presses are mis-aimed
  }
  return false
}
