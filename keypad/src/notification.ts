// Conservative classifier for Notification messages.
//
// Claude Code fires the Notification hook for two very different reasons:
//   1. Permission prompt for a tool call in the current task
//      (e.g. "Claude needs your permission to use Bash")
//      → Approve = '1⏎' is safe and helpful.
//   2. Open-ended question that may pivot the work
//      (e.g. "Want me to refactor X instead?")
//      → Approve would blindly accept a direction change. Unsafe.
//
// The keypad can't tell the user's intent, so it must default to safety:
// Approve is enabled ONLY when the notification message matches a known
// permission-prompt pattern. Unknown phrasing → greyed.
//
// The allowlist starts empty by design — real notification samples are
// being logged to hooks-debug.log; patterns get added once we've seen
// enough examples to write them without guessing.

/**
 * Known permission-prompt phrasings. Each entry is matched case-insensitively
 * as a substring of the notification message. Empty list = no auto-approve.
 *
 * Add patterns here only after observing them in hooks-debug.log.
 */
const PERMISSION_PROMPT_PATTERNS: ReadonlyArray<string> = [
  // Tool permission prompts — observed in hooks-debug.log as
  //   "Claude needs your permission to use Bash"
  //   "Claude needs your permission to use Edit"
  // These are always about the current task: Claude wants to run an
  // in-flight tool call. Approving them advances the task; rejecting
  // them aborts the tool. They never represent a direction change.
  'Claude needs your permission to use',
]

/**
 * Returns true only when the message is recognizably a permission prompt
 * for the current task. Null/empty/unknown messages → false (safety default).
 */
export function isPermissionPrompt(message: string | null | undefined): boolean {
  if (!message) return false
  const lower = message.toLowerCase()
  return PERMISSION_PROMPT_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
}
