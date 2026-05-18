import { describe, it, expect } from 'vitest'
import { nextEffort } from './effort.js'

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
