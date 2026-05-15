// Display formatters for the status tile.

const TITLE_MAX = 12

/**
 * One-word title for a session. Falls back to em-dash if no project.
 * Truncated to TITLE_MAX without an ellipsis (each char counts on a 118px LCD).
 */
export function formatTitle(project: string | null | undefined): string {
  if (!project) return '—'
  return project.length > TITLE_MAX ? project.slice(0, TITLE_MAX) : project
}

/**
 * Compress Claude Code's full model id into a short tile-friendly label.
 *   claude-opus-4-7[1m]   → opus 4-7[1m]
 *   claude-sonnet-4-6     → sonnet 4-6
 *   claude-haiku-4-5-...  → haiku 4-5-...
 * Strips a leading "claude-" and turns the next "-" into a space, leaving
 * the rest of the version intact.
 */
export function formatModel(model: string | null | undefined): string {
  if (!model) return ''
  let s = model
  if (s.startsWith('claude-')) s = s.slice('claude-'.length)
  const i = s.indexOf('-')
  if (i >= 0) s = s.slice(0, i) + ' ' + s.slice(i + 1)
  return s
}
