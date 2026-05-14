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

  it('primary on ended → Resume', () => {
    expect(actionLabel('ended', 'primary')).toBe('Resume')
  })

  it('secondary normally → Focus', () => {
    expect(actionLabel('done', 'secondary')).toBe('Focus')
    expect(actionLabel('thinking', 'secondary')).toBe('Focus')
    expect(actionLabel('waiting_input', 'secondary')).toBe('Focus')
  })

  it('secondary on ended → Dismiss', () => {
    expect(actionLabel('ended', 'secondary')).toBe('Dismiss')
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

  it('ended-state buttons have a distinct color from alive equivalents', () => {
    expect(actionBg('ended', 'primary')).not.toBe(actionBg('done', 'primary'))
    expect(actionBg('ended', 'secondary')).not.toBe(actionBg('done', 'secondary'))
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

  it('primary enabled on waiting_input (Approve) and ended (Resume)', () => {
    expect(isActionEnabled('waiting_input', 'primary')).toBe(true)
    expect(isActionEnabled('ended', 'primary')).toBe(true)
  })

  it('secondary (Focus / Dismiss) always enabled when a session exists', () => {
    for (const s of ['idle', 'thinking', 'done', 'waiting_input', 'ended'] as const) {
      expect(isActionEnabled(s, 'secondary')).toBe(true)
    }
  })

  it('null session → both disabled', () => {
    expect(isActionEnabled(null, 'primary')).toBe(false)
    expect(isActionEnabled(null, 'secondary')).toBe(false)
  })
})
