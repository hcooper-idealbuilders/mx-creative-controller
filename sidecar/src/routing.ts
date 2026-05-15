// Pure command-routing logic. Given a keypad-level command + a session's
// current state, decide what the sidecar should do.
//
// Extracted from index.ts so it can be unit-tested without spinning up
// WebSockets or shelling out to PowerShell.
import type { KeystrokeCommand } from './keystroke-sender.js'
import type { SessionState } from './sessions-watcher.js'

export type IncomingCommand = 'continue' | 'focus'

export type RoutingResult =
  | { kind: 'keystroke'; keystroke: KeystrokeCommand }
  | { kind: 'unknown' }

/**
 * Map a keypad command + session state to the actual side effect.
 *   continue + waiting_input → approve  (sends `y⏎`)
 *   focus                    → focus    (focus window, no keys)
 *
 * The keypad's primary button is gated by isActionEnabled and only
 * dispatches "continue" when state === waiting_input, so the routing
 * doesn't need a fallback continue keystroke any more — anything else
 * arriving here is unexpected.
 */
export function routeCommand(command: string, state: SessionState): RoutingResult {
  if (command === 'continue' && state === 'waiting_input') {
    return { kind: 'keystroke', keystroke: 'approve' }
  }
  if (command === 'focus') return { kind: 'keystroke', keystroke: 'focus' }
  return { kind: 'unknown' }
}
