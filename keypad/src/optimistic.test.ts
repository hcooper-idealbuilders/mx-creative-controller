import { describe, it, expect } from 'vitest'
import { applyOptimisticUpdate, mergeWithOptimistic } from './optimistic.js'
import type { SessionState, SessionStatus } from './state.js'

const make = (id: string, state: SessionState): SessionStatus => ({
  state, project: id, model: null, fast_mode: false,
  session_id: id, claude_pid: null, claude_hwnd: null,
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

describe('mergeWithOptimistic', () => {
  it('keeps local state when within hold window', () => {
    const incoming = [make('a', 'waiting_input')]
    const local    = [make('a', 'thinking')]
    const opt = new Map([['a', 1000]])
    const merged = mergeWithOptimistic(incoming, local, opt, 1500, 1500)
    expect(merged[0].state).toBe('thinking') // local kept
  })

  it('accepts incoming after hold window expires', () => {
    const incoming = [make('a', 'done')]
    const local    = [make('a', 'thinking')]
    const opt = new Map([['a', 0]])
    const merged = mergeWithOptimistic(incoming, local, opt, 2000, 1500)
    expect(merged[0].state).toBe('done') // incoming accepted
  })

  it('no local entry for session → use incoming', () => {
    const incoming = [make('a', 'done')]
    const merged = mergeWithOptimistic(incoming, [], new Map(), 0, 1500)
    expect(merged[0].state).toBe('done')
  })

  it('only holds the session being optimistically updated', () => {
    const incoming = [make('a', 'waiting_input'), make('b', 'done')]
    const local    = [make('a', 'thinking'),     make('b', 'thinking')]
    const opt = new Map([['a', 1000]]) // only a is in hold
    const merged = mergeWithOptimistic(incoming, local, opt, 1500, 1500)
    expect(merged[0].state).toBe('thinking') // a held
    expect(merged[1].state).toBe('done')     // b accepted incoming
  })

  it('preserves incoming order (FIFO)', () => {
    const incoming = [make('b', 'idle'), make('a', 'idle')]
    const local: SessionStatus[] = []
    const merged = mergeWithOptimistic(incoming, local, new Map(), 0, 1500)
    expect(merged.map((s) => s.session_id)).toEqual(['b', 'a'])
  })
})
