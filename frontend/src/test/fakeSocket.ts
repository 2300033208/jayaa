import type { WebSocketLike } from '../api/socket'

/** Scriptable stand-in for WebSocket, used only in tests. */
export class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = []
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  closed = false
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  static reset(): void {
    FakeSocket.instances = []
  }

  static latest(): FakeSocket {
    const socket = FakeSocket.instances.at(-1)
    if (socket === undefined) throw new Error('no socket was opened')
    return socket
  }

  open(): void {
    this.onopen?.(new Event('open'))
  }

  send(message: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: typeof message === 'string' ? message : JSON.stringify(message) }))
  }

  drop(code = 1006, reason = ''): void {
    this.closed = true
    this.onclose?.(new CloseEvent('close', { code, reason }))
  }

  close(): void {
    this.closed = true
  }
}
