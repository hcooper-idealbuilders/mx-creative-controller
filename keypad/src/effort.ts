// Effort-level cycling for the status key.
//
// Claude Code's /effort <level> command is per-session (doesn't pollute global
// settings.json). Hooks don't surface the current level, so the keypad tracks
// only what *it* set most recently — null until first press.

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh'

const CYCLE: ReadonlyArray<EffortLevel> = ['low', 'medium', 'high', 'xhigh']

/** Next level in the cycle. Null (never pressed) advances to 'low'. */
export function nextEffort(current: EffortLevel | null): EffortLevel {
  if (!current) return 'low'
  const idx = CYCLE.indexOf(current)
  return CYCLE[(idx + 1) % CYCLE.length]
}

/** Short label for display on the status key. */
export function effortShort(level: EffortLevel): string {
  switch (level) {
    case 'low':    return 'L'
    case 'medium': return 'M'
    case 'high':   return 'H'
    case 'xhigh':  return 'X'
  }
}
