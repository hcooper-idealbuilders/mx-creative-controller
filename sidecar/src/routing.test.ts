import { describe, it, expect } from 'vitest'
import { routeCommand } from './routing.js'

describe('routeCommand', () => {
  it('continue + waiting_input → approve keystroke', () => {
    expect(routeCommand('continue', 'waiting_input'))
      .toEqual({ kind: 'keystroke', keystroke: 'approve' })
  })

  for (const state of ['idle', 'thinking', 'done'] as const) {
    it(`continue + ${state} → unknown (keypad shouldn't dispatch)`, () => {
      expect(routeCommand('continue', state)).toEqual({ kind: 'unknown' })
    })
  }

  it('focus → focus keystroke (no keys, window only)', () => {
    for (const state of ['idle', 'thinking', 'done', 'waiting_input'] as const) {
      expect(routeCommand('focus', state))
        .toEqual({ kind: 'keystroke', keystroke: 'focus' })
    }
  })

  it('effort-* → matching keystroke regardless of state', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh'] as const) {
      const cmd = `effort-${level}`
      expect(routeCommand(cmd, 'done'))
        .toEqual({ kind: 'keystroke', keystroke: cmd })
    }
  })

  it('unknown command → unknown', () => {
    expect(routeCommand('garbage', 'done')).toEqual({ kind: 'unknown' })
    expect(routeCommand('', 'done')).toEqual({ kind: 'unknown' })
    expect(routeCommand('resume', 'done')).toEqual({ kind: 'unknown' })
    expect(routeCommand('dismiss', 'done')).toEqual({ kind: 'unknown' })
  })
})
