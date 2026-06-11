import { describe, it, expect } from 'vitest'
import { columnsRemapped } from './remap.js'

describe('columnsRemapped', () => {
  it('no change → false', () => {
    expect(columnsRemapped(['a', 'b'], ['a', 'b'])).toBe(false)
    expect(columnsRemapped([], [])).toBe(false)
  })

  it('new session appended to empty column → false (no mis-aim risk)', () => {
    expect(columnsRemapped(['a'], ['a', 'b'])).toBe(false)
    expect(columnsRemapped([], ['a'])).toBe(false)
  })

  it('session removed, later columns shift left → true', () => {
    // a ends: b and c shift into columns 0 and 1
    expect(columnsRemapped(['a', 'b', 'c'], ['b', 'c'])).toBe(true)
  })

  it('middle session removed → true', () => {
    expect(columnsRemapped(['a', 'b', 'c'], ['a', 'c'])).toBe(true)
  })

  it('last session removed (column empties) → true', () => {
    // The user may be mid-press on that column expecting the old session.
    expect(columnsRemapped(['a', 'b'], ['a'])).toBe(true)
  })

  it('same count but identity swapped → true', () => {
    expect(columnsRemapped(['a', 'b'], ['a', 'c'])).toBe(true)
  })

  it('state-only updates do not look like remaps (ids stable)', () => {
    expect(columnsRemapped(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(false)
  })
})
