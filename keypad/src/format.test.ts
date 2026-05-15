import { describe, it, expect } from 'vitest'
import { formatTitle, formatModel } from './format.js'

describe('formatTitle', () => {
  it('returns project name unchanged if short enough', () => {
    expect(formatTitle('Hardware')).toBe('Hardware')
  })
  it('truncates to 12 chars without ellipsis', () => {
    expect(formatTitle('Hardware-interface')).toBe('Hardware-int')
    expect(formatTitle('Hardware-interface').length).toBe(12)
  })
  it('em-dash for null/empty', () => {
    expect(formatTitle(null)).toBe('—')
    expect(formatTitle(undefined)).toBe('—')
    expect(formatTitle('')).toBe('—')
  })
})

describe('formatModel', () => {
  it('strips claude- prefix and turns model dash into space', () => {
    expect(formatModel('claude-opus-4-7')).toBe('opus 4-7')
    expect(formatModel('claude-sonnet-4-6')).toBe('sonnet 4-6')
    expect(formatModel('claude-haiku-4-5')).toBe('haiku 4-5')
  })
  it('preserves trailing context-window tag', () => {
    expect(formatModel('claude-opus-4-7[1m]')).toBe('opus 4-7[1m]')
  })
  it('handles non-claude-prefixed strings gracefully', () => {
    expect(formatModel('opus-4-7')).toBe('opus 4-7')
  })
  it('empty string for null/undefined/empty', () => {
    expect(formatModel(null)).toBe('')
    expect(formatModel(undefined)).toBe('')
    expect(formatModel('')).toBe('')
  })
})
