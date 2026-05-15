import { describe, it, expect } from 'vitest'
import { getEffectiveSessions, pruneOptimistic, type OptimisticEntry } from './optimistic.js'
import type { SessionState, SessionStatus } from './state.js'

const make = (id: string, state: SessionState): SessionStatus => ({
  state, project: id, model: null, fast_mode: false,
  session_id: id, claude_pid: null, claude_hwnd: null,
  first_seen: null, last_event: null, last_updated: null,
})

describe('getEffectiveSessions', () => {
  it('fresh optimistic overlay wins over real state', () => {
    const real = [make('a', 'waiting_input')]
    const opt = new Map<string, OptimisticEntry>([['a', { state: 'thinking', at: 1000 }]])
    const out = getEffectiveSessions(real, opt, 1500, 1500)
    expect(out[0].state).toBe('thinking')
  })

  it('expired optimistic overlay falls through to real state', () => {
    const real = [make('a', 'waiting_input')]
    const opt = new Map<string, OptimisticEntry>([['a', { state: 'thinking', at: 0 }]])
    const out = getEffectiveSessions(real, opt, 2000, 1500)
    expect(out[0].state).toBe('waiting_input')
  })

  it('absent overlay falls through to real state', () => {
    const real = [make('a', 'done')]
    const out = getEffectiveSessions(real, new Map(), 0, 1500)
    expect(out[0].state).toBe('done')
  })

  it('only affects matching session_id', () => {
    const real = [make('a', 'done'), make('b', 'waiting_input')]
    const opt = new Map<string, OptimisticEntry>([['a', { state: 'thinking', at: 1000 }]])
    const out = getEffectiveSessions(real, opt, 1500, 1500)
    expect(out[0].state).toBe('thinking')
    expect(out[1].state).toBe('waiting_input')
  })

  it('preserves project/model/pid (only state is overlaid)', () => {
    const real = [make('a', 'waiting_input')]
    real[0].project = 'p'
    real[0].claude_pid = 42
    const opt = new Map<string, OptimisticEntry>([['a', { state: 'thinking', at: 1000 }]])
    const out = getEffectiveSessions(real, opt, 1500, 1500)
    expect(out[0].project).toBe('p')
    expect(out[0].claude_pid).toBe(42)
    expect(out[0].state).toBe('thinking')
  })

  it('returns a fresh array (does not mutate input)', () => {
    const real = [make('a', 'done')]
    const out = getEffectiveSessions(real, new Map(), 0, 1500)
    expect(out).not.toBe(real)
    expect(out[0]).toBe(real[0]) // sessions without overlay aren't recreated
  })
})

describe('pruneOptimistic', () => {
  it('drops entries older than the hold window', () => {
    const opt = new Map<string, OptimisticEntry>([
      ['old',   { state: 'thinking', at: 100 }],
      ['fresh', { state: 'thinking', at: 1500 }],
    ])
    const out = pruneOptimistic(opt, 2000, 1000)
    expect(out.has('old')).toBe(false)
    expect(out.has('fresh')).toBe(true)
  })

  it('returns a fresh map (input unchanged)', () => {
    const opt = new Map<string, OptimisticEntry>([['a', { state: 'thinking', at: 0 }]])
    const out = pruneOptimistic(opt, 99999, 1000)
    expect(opt.size).toBe(1)
    expect(out.size).toBe(0)
  })
})
