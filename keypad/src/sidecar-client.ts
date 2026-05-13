// WebSocket client to the sidecar. Reconnects forever with backoff.
import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import type { Status, Command } from './state.js'

export class SidecarClient extends EventEmitter {
  private ws: WebSocket | null = null
  private url: string
  private backoffMs = 500
  private closed = false

  constructor(url: string) {
    super()
    this.url = url
  }

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
          | { type: 'status'; status: Status }
          | { type: string; [k: string]: unknown }
        if (msg.type === 'status') this.emit('status', msg.status)
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
    this.ws.on('error', () => {/* close handler will reconnect */})
  }

  sendCommand(command: Command): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'command', command }))
    }
  }

  close(): void {
    this.closed = true
    this.ws?.close()
  }
}
