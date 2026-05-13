import { describe, it, expect } from 'vitest'
import { hasRecentError, recordError, pruneErrors, type CommandError } from './errors.js'

describe('hasRecentError', () => {
  it('returns true while error is within window', () => {
    const errors = new Map<string, CommandError>([['s1', { command: 'continue', at: 1000 }]])
    expect(hasRecentError('s1', errors, 1500, 2000)).toBe(true)
  })

  it('returns false after window expires', () => {
    const errors = new Map<string, CommandError>([['s1', { command: 'continue', at: 1000 }]])
    expect(hasRecentError('s1', errors, 4000, 2000)).toBe(false)
  })

  it('returns false for unknown session', () => {
    expect(hasRecentError('s1', new Map(), 0, 2000)).toBe(false)
  })
})

describe('recordError', () => {
  it('adds new error without mutating input', () => {
    const before = new Map<string, CommandError>()
    const after  = recordError(before, 's1', 'continue', 100, 'boom')
    expect(before.size).toBe(0)
    expect(after.get('s1')).toEqual({ command: 'continue', at: 100, message: 'boom' })
  })

  it('overwrites prior error for the same session', () => {
    const before = new Map<string, CommandError>([['s1', { command: 'focus', at: 100 }]])
    const after  = recordError(before, 's1', 'continue', 200)
    expect(after.get('s1')?.command).toBe('continue')
    expect(after.get('s1')?.at).toBe(200)
  })
})

describe('pruneErrors', () => {
  it('drops entries older than window', () => {
    const errors = new Map<string, CommandError>([
      ['old',    { command: 'continue', at: 100 }],
      ['recent', { command: 'focus',    at: 1500 }],
    ])
    const after = pruneErrors(errors, 2000, 1000)
    expect(after.has('old')).toBe(false)
    expect(after.has('recent')).toBe(true)
  })

  it('returns a fresh map (input unchanged)', () => {
    const before = new Map<string, CommandError>([['s', { command: 'focus', at: 0 }]])
    const after  = pruneErrors(before, 99999, 1000)
    expect(before.size).toBe(1) // still there
    expect(after.size).toBe(0)
  })
})
