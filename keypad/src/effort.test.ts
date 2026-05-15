import { describe, it, expect } from 'vitest'
import { nextEffort, effortShort } from './effort.js'

describe('nextEffort', () => {
  it('null → low (first press)', () => {
    expect(nextEffort(null)).toBe('low')
  })

  it('cycles low → medium → high → xhigh → low', () => {
    expect(nextEffort('low')).toBe('medium')
    expect(nextEffort('medium')).toBe('high')
    expect(nextEffort('high')).toBe('xhigh')
    expect(nextEffort('xhigh')).toBe('low')
  })
})

describe('effortShort', () => {
  it('returns a single-letter glyph', () => {
    expect(effortShort('low')).toBe('L')
    expect(effortShort('medium')).toBe('M')
    expect(effortShort('high')).toBe('H')
    expect(effortShort('xhigh')).toBe('X')
  })
})
