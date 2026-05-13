import { describe, it, expect } from 'vitest'
import { applyOptimisticUpdate } from './optimistic.js'
import type { SessionState, SessionStatus } from './state.js'

const make = (id: string, state: SessionState): SessionStatus => ({
  state, project: id, model: null, fast_mode: false,
  session_id: id, claude_pid: null,
  first_seen: null, last_event: null, last_updated: null,
})

describe('applyOptimisticUpdate', () => {
  it('continue → target session flips to thinking', () => {
    const after = applyOptimisticUpdate([make('a', 'done')], 'a', 'continue')
    expect(after[0].state).toBe('thinking')
    expect(after[0].last_event).toBe('optimistic:continue')
  })

  it('continue from waiting_input (Approve press) → thinking', () => {
    const after = applyOptimisticUpdate([make('a', 'waiting_input')], 'a', 'continue')
    expect(after[0].state).toBe('thinking')
  })

  it('resume → target session flips to thinking', () => {
    const after = applyOptimisticUpdate([make('a', 'ended')], 'a', 'resume')
    expect(after[0].state).toBe('thinking')
    expect(after[0].last_event).toBe('optimistic:resume')
  })

  it('dismiss → session removed from array', () => {
    const before = [make('a', 'ended'), make('b', 'done')]
    const after  = applyOptimisticUpdate(before, 'a', 'dismiss')
    expect(after.length).toBe(1)
    expect(after[0].session_id).toBe('b')
  })

  it('focus → no state change', () => {
    const before = [make('a', 'done')]
    const after  = applyOptimisticUpdate(before, 'a', 'focus')
    expect(after[0].state).toBe('done')
    expect(after[0].last_event).toBeNull()
  })

  it('does not touch sibling sessions', () => {
    const before = [make('a', 'done'), make('b', 'waiting_input')]
    const after  = applyOptimisticUpdate(before, 'a', 'continue')
    expect(after[1].state).toBe('waiting_input')
    expect(after[0].state).toBe('thinking')
  })

  it('returns a fresh array (does not mutate input)', () => {
    const before = [make('a', 'done')]
    const after  = applyOptimisticUpdate(before, 'a', 'continue')
    expect(after).not.toBe(before)
    expect(before[0].state).toBe('done') // input unchanged
  })

  it('unknown session id → no change', () => {
    const before = [make('a', 'done')]
    const after  = applyOptimisticUpdate(before, 'nonexistent', 'continue')
    expect(after).toEqual(before)
  })
})
