import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import type { SessionStatus, SessionState, Command } from './state.js'

export interface CommandResult {
  sessionId: string
  command: Command
  success: boolean
  error?: string
}

const VALID_STATES = new Set<SessionState>(['idle', 'thinking', 'done', 'waiting_input'])

/**
 * Drop sessions whose state isn't one we currently render — e.g. a stray
 * 'ended' from a session.json that survived an older schema. Without this
 * guard, `STATE_BG[state]` returns undefined in the renderer and the tile
 * silently fails to paint a background.
 */
function sanitizeSessions(arr: unknown): SessionStatus[] {
  if (!Array.isArray(arr)) return []
  return arr.filter((s): s is SessionStatus =>
    !!s && typeof s === 'object'
       && typeof (s as { session_id?: unknown }).session_id === 'string'
       && VALID_STATES.has((s as { state: SessionState }).state),
  )
}

export class SidecarClient extends EventEmitter {
  private ws: WebSocket | null = null
  private backoffMs = 500
  private closed = false

  constructor(private url: string) { super() }

  connect(): void {
    if (this.closed) return
    this.ws = new WebSocket(this.url)
    this.ws.on('open', () => {
      console.log(`[sidecar-client] connected ${this.url}`)
      this.backoffMs = 500
      this.emit('open')
    })
    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>
        if (msg.type === 'sessions') {
          this.emit('sessions', sanitizeSessions(msg.sessions))
        } else if (msg.type === 'command-result' && typeof msg.sessionId === 'string') {
          this.emit('command-result', {
            sessionId: msg.sessionId,
            command:   msg.command as Command,
            success:   !!msg.success,
            error:     typeof msg.error === 'string' ? msg.error : undefined,
          } satisfies CommandResult)
        }
      } catch {
        // ignore malformed
      }
    })
    const reconnect = () => {
      if (this.closed) return
      this.emit('close')
      const wait = this.backoffMs
      this.backoffMs = Math.min(this.backoffMs * 2, 10_000)
      setTimeout(() => this.connect(), wait)
    }
    this.ws.on('close', reconnect)
    this.ws.on('error', () => {/* close handler reconnects */})
  }

  sendCommand(sessionId: string, command: Command): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'command', sessionId, command }))
    }
  }

  close(): void {
    this.closed = true
    this.ws?.close()
  }
}
