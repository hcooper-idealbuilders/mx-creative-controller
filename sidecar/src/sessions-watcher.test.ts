import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionsWatcher, type SessionStatus, type SessionState } from './sessions-watcher.js'

let dir: string
let watcher: SessionsWatcher

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sw-test-'))
})

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

async function writeSession(id: string, first_seen: string, state: SessionState = 'idle') {
  const status: SessionStatus = {
    state, project: id, model: null, fast_mode: false,
    session_id: id, claude_pid: null, claude_hwnd: null,
    first_seen, last_event: 'SessionStart', last_updated: first_seen,
  }
  await writeFile(join(dir, `${id}.json`), JSON.stringify(status))
}

describe('SessionsWatcher', () => {
  it('orders sessions by first_seen ascending (FIFO)', async () => {
    await writeSession('b', '2026-05-13T11:00:00Z')
    await writeSession('a', '2026-05-13T10:00:00Z')
    await writeSession('c', '2026-05-13T12:00:00Z')

    watcher = new SessionsWatcher(dir)
    await watcher.start()

    expect(watcher.sessions.map((s) => s.session_id)).toEqual(['a', 'b', 'c'])
  })

  it('getByColumn returns FIFO mapping; out-of-range → null', async () => {
    await writeSession('only', '2026-05-13T10:00:00Z')
    watcher = new SessionsWatcher(dir)
    await watcher.start()

    expect(watcher.getByColumn(0)?.session_id).toBe('only')
    expect(watcher.getByColumn(1)).toBeNull()
    expect(watcher.getByColumn(99)).toBeNull()
  })

  it('getBySessionId finds by id', async () => {
    await writeSession('abc', '2026-05-13T10:00:00Z')
    watcher = new SessionsWatcher(dir)
    await watcher.start()

    expect(watcher.getBySessionId('abc')?.session_id).toBe('abc')
    expect(watcher.getBySessionId('nope')).toBeNull()
  })

  it('skips malformed JSON without crashing', async () => {
    await writeSession('good', '2026-05-13T10:00:00Z')
    await writeFile(join(dir, 'bad.json'), '{ not valid json')

    watcher = new SessionsWatcher(dir)
    await watcher.start()

    expect(watcher.sessions.map((s) => s.session_id)).toEqual(['good'])
  })

  it('strips UTF-8 BOM from session files (PowerShell quirk)', async () => {
    const status: SessionStatus = {
      state: 'idle', project: 'p', model: null, fast_mode: false,
      session_id: 'bom', claude_pid: null, claude_hwnd: null,
      first_seen: '2026-05-13T10:00:00Z', last_event: 'SessionStart', last_updated: '2026-05-13T10:00:00Z',
    }
    await writeFile(join(dir, 'bom.json'), '\uFEFF' + JSON.stringify(status))

    watcher = new SessionsWatcher(dir)
    await watcher.start()

    expect(watcher.sessions.map((s) => s.session_id)).toEqual(['bom'])
  })

  it('dismiss() removes the session file from disk', async () => {
    await writeSession('a', '2026-05-13T10:00:00Z')
    watcher = new SessionsWatcher(dir)
    await watcher.start()
    expect(watcher.sessions.length).toBe(1)

    await watcher.dismiss('a')

    const fresh = new SessionsWatcher(dir)
    await fresh.start()
    expect(fresh.sessions.length).toBe(0)
  })

  it('dismiss() ignores path-traversal attempts', async () => {
    await writeSession('keep', '2026-05-13T10:00:00Z')
    watcher = new SessionsWatcher(dir)
    await watcher.start()

    await watcher.dismiss('../keep')
    await watcher.dismiss('')

    const fresh = new SessionsWatcher(dir)
    await fresh.start()
    expect(fresh.sessions.map((s) => s.session_id)).toEqual(['keep'])
  })
})
