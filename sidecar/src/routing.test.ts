import { describe, it, expect } from 'vitest'
import { routeCommand } from './routing.js'

describe('routeCommand', () => {
  it('continue + waiting_input → approve keystroke (smart Continue)', () => {
    expect(routeCommand('continue', 'waiting_input'))
      .toEqual({ kind: 'keystroke', keystroke: 'approve' })
  })

  for (const state of ['idle', 'thinking', 'done', 'ended'] as const) {
    it(`continue + ${state} → continue keystroke`, () => {
      expect(routeCommand('continue', state))
        .toEqual({ kind: 'keystroke', keystroke: 'continue' })
    })
  }

  it('resume → resume keystroke regardless of state', () => {
    expect(routeCommand('resume', 'ended'))
      .toEqual({ kind: 'keystroke', keystroke: 'resume' })
    expect(routeCommand('resume', 'done'))
      .toEqual({ kind: 'keystroke', keystroke: 'resume' })
  })

  it('focus → focus keystroke (no keys, window only)', () => {
    expect(routeCommand('focus', 'done'))
      .toEqual({ kind: 'keystroke', keystroke: 'focus' })
  })

  it('dismiss → dismiss action (no keystroke)', () => {
    expect(routeCommand('dismiss', 'ended'))
      .toEqual({ kind: 'dismiss' })
  })

  it('unknown command → unknown', () => {
    expect(routeCommand('garbage', 'done')).toEqual({ kind: 'unknown' })
    expect(routeCommand('', 'done')).toEqual({ kind: 'unknown' })
  })
})
