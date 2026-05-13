import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import type { SessionStatus, Command } from './state.js'

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
        const msg = JSON.parse(data.toString()) as
          | { type: 'sessions'; sessions: SessionStatus[] }
          | { type: string; [k: string]: unknown }
        if (msg.type === 'sessions' && Array.isArray((msg as any).sessions)) {
          this.emit('sessions', (msg as { sessions: SessionStatus[] }).sessions)
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
