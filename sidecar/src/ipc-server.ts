import { EventEmitter } from 'node:events'
import { WebSocketServer, WebSocket } from 'ws'

type Send = (msg: unknown) => void

export interface CommandMessage {
  type: 'command'
  sessionId: string
  command: string
}

export class IpcServer extends EventEmitter {
  private wss: WebSocketServer | null = null
  private clients = new Set<WebSocket>()

  constructor(private port: number) { super() }

  start(): void {
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port })
    this.wss.on('connection', (ws) => {
      this.clients.add(ws)
      const sendOne: Send = (msg) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
      }
      this.emit('connect', sendOne)
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as Partial<CommandMessage>
          if (msg.type === 'command' && typeof msg.sessionId === 'string' && typeof msg.command === 'string') {
            this.emit('command', msg as CommandMessage)
          }
        } catch {
          // ignore malformed
        }
      })
      ws.on('close', () => this.clients.delete(ws))
    })
  }

  broadcast(msg: unknown): void {
    const data = JSON.stringify(msg)
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    }
  }
}
