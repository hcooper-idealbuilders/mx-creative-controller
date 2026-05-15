import { describe, it, expect } from 'vitest'
import { actionLabel, actionBg, isActionEnabled } from './labels.js'

describe('actionLabel', () => {
  it('primary on waiting_input → Approve (smart Continue)', () => {
    expect(actionLabel('waiting_input', 'primary')).toBe('Approve')
  })

  it('primary on done → Continue', () => {
    expect(actionLabel('done', 'primary')).toBe('Continue')
  })

  it('primary on idle → Continue', () => {
    expect(actionLabel('idle', 'primary')).toBe('Continue')
  })

  it('primary on thinking → Continue', () => {
    expect(actionLabel('thinking', 'primary')).toBe('Continue')
  })

  it('secondary always → Focus', () => {
    for (const s of ['done', 'thinking', 'waiting_input', 'idle'] as const) {
      expect(actionLabel(s, 'secondary')).toBe('Focus')
    }
  })

  it('null session → empty label', () => {
    expect(actionLabel(null, 'primary')).toBe('')
    expect(actionLabel(null, 'secondary')).toBe('')
  })
})

describe('actionBg', () => {
  it('primary bg distinguishes waiting_input from other live states', () => {
    const waiting = actionBg('waiting_input', 'primary')
    const done    = actionBg('done', 'primary')
    const idle    = actionBg('idle', 'primary')
    expect(waiting).not.toBe(done)
    expect(idle).toBe(done)
  })

  it('null session → dark (matches the blank status key)', () => {
    expect(actionBg(null, 'primary')).toMatch(/^#0[a-f0-9]{5}$/i)
  })
})

describe('isActionEnabled', () => {
  it('primary disabled while thinking (avoids stray prompts mid-response)', () => {
    expect(isActionEnabled('thinking', 'primary')).toBe(false)
  })

  it('primary disabled while idle (no pending input request)', () => {
    expect(isActionEnabled('idle', 'primary')).toBe(false)
  })

  it('primary disabled when done — Claude is not waiting on you', () => {
    expect(isActionEnabled('done', 'primary')).toBe(false)
  })

  it('primary enabled only on waiting_input (Approve)', () => {
    expect(isActionEnabled('waiting_input', 'primary')).toBe(true)
  })

  it('secondary (Focus) always enabled when a session exists', () => {
    for (const s of ['idle', 'thinking', 'done', 'waiting_input'] as const) {
      expect(isActionEnabled(s, 'secondary')).toBe(true)
    }
  })

  it('null session → both disabled', () => {
    expect(isActionEnabled(null, 'primary')).toBe(false)
    expect(isActionEnabled(null, 'secondary')).toBe(false)
  })
})
