// Pure command-routing logic. Given a keypad-level command + a session's
// current state, decide what the sidecar should do.
//
// Extracted from index.ts so it can be unit-tested without spinning up
// WebSockets or shelling out to PowerShell.
import type { KeystrokeCommand } from './keystroke-sender.js'
import type { SessionState } from './sessions-watcher.js'

export type RoutingResult =
  | { kind: 'keystroke'; keystroke: KeystrokeCommand }
  | { kind: 'unknown' }

const EFFORT_COMMANDS = new Set<string>([
  'effort-low', 'effort-medium', 'effort-high', 'effort-xhigh',
])

/**
 * Map a keypad command + session state to the actual side effect.
 *   continue + waiting_input → approve         (sends `1⏎`)
 *   focus                    → focus           (focus window, no keys)
 *   fast                     → fast            (sends `/fast⏎`)
 *   effort-<level>           → effort-<level>  (sends `/effort <level>⏎`)
 *
 * The keypad's primary button is gated by isActionEnabled and only
 * dispatches "continue" when state === waiting_input.
 */
export function routeCommand(command: string, state: SessionState): RoutingResult {
  if (command === 'continue' && state === 'waiting_input') {
    return { kind: 'keystroke', keystroke: 'approve' }
  }
  if (command === 'focus') return { kind: 'keystroke', keystroke: 'focus' }
  if (command === 'fast')  return { kind: 'keystroke', keystroke: 'fast' }
  if (EFFORT_COMMANDS.has(command)) {
    return { kind: 'keystroke', keystroke: command as KeystrokeCommand }
  }
  return { kind: 'unknown' }
}
