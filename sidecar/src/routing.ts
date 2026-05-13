// Pure command-routing logic. Given a keypad-level command + a session's
// current state, decide what the sidecar should do.
//
// Extracted from index.ts so it can be unit-tested without spinning up
// WebSockets or shelling out to PowerShell.
import type { KeystrokeCommand } from './keystroke-sender.js'
import type { SessionState } from './sessions-watcher.js'

export type IncomingCommand = 'continue' | 'resume' | 'focus' | 'dismiss'

export type RoutingResult =
  | { kind: 'keystroke'; keystroke: KeystrokeCommand }
  | { kind: 'dismiss' }
  | { kind: 'unknown' }

/**
 * Map a keypad command + session state to the actual side effect.
 *   continue + waiting_input → approve  (sends `y⏎`)
 *   continue + anything else → continue (sends `continue⏎`)
 *   resume                  → resume   (sends `/resume⏎`)
 *   focus                   → focus    (focus window, no keys)
 *   dismiss                 → dismiss  (delete session file, no keys)
 */
export function routeCommand(command: string, state: SessionState): RoutingResult {
  if (command === 'dismiss') return { kind: 'dismiss' }
  if (command === 'continue') {
    return { kind: 'keystroke', keystroke: state === 'waiting_input' ? 'approve' : 'continue' }
  }
  if (command === 'resume') return { kind: 'keystroke', keystroke: 'resume' }
  if (command === 'focus')  return { kind: 'keystroke', keystroke: 'focus' }
  return { kind: 'unknown' }
}
