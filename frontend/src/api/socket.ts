import type { SimulationEvent } from '../types/api'
import { backoffDelay } from '../utils/time'
import { wsUrl } from './client'
import { parseMessage } from './events'
import { reportSessionLost } from './session'

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'failed' | 'closed'

export type RejectionKind = 'malformed' | 'unknown' | 'foreign'

export interface ConnectionInfo {
  attempt: number
  reason: string | null
}

export interface SocketHandlers {
  onEvent: (event: SimulationEvent) => void
  onState: (state: ConnectionState, info: ConnectionInfo) => void
  onRejected: (kind: RejectionKind, detail: string) => void
  /** Highest measurement index already held; the engine replays everything after it. */
  resumeIndex: () => number
}

export interface WebSocketLike {
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  close: (code?: number, reason?: string) => void
}

export interface SocketOptions {
  maxReconnectAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  heartbeatTimeoutMs?: number
  createSocket?: (url: string) => WebSocketLike
}

const TERMINAL_EVENTS = new Set(['simulation_completed', 'simulation_failed', 'simulation_cancelled'])

/**
 * One live stream for one simulation. Guarantees at most one open socket, ignores callbacks
 * from superseded sockets, reconnects with bounded exponential backoff, and asks the engine to
 * replay only measurements after the last one received so nothing is duplicated.
 */
export class SimulationSocket {
  readonly simulationId: string
  private readonly handlers: SocketHandlers
  private readonly maxAttempts: number
  private readonly baseDelay: number
  private readonly maxDelay: number
  private readonly heartbeatTimeout: number
  private readonly create: (url: string) => WebSocketLike
  private ws: WebSocketLike | null = null
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private finished = false
  private disposed = false
  private state: ConnectionState = 'idle'

  constructor(simulationId: string, handlers: SocketHandlers, options: SocketOptions = {}) {
    this.simulationId = simulationId
    this.handlers = handlers
    this.maxAttempts = options.maxReconnectAttempts ?? 6
    this.baseDelay = options.baseDelayMs ?? 500
    this.maxDelay = options.maxDelayMs ?? 8000
    this.heartbeatTimeout = options.heartbeatTimeoutMs ?? 25_000
    this.create = options.createSocket ?? ((url) => new WebSocket(url))
  }

  get connectionState(): ConnectionState {
    return this.state
  }

  connect(): void {
    if (this.disposed || this.ws !== null || this.reconnectTimer !== null) return
    this.open()
  }

  /** Manual retry after the automatic attempts are exhausted. */
  retry(): void {
    if (this.disposed || this.ws !== null) return
    this.clearReconnect()
    this.attempt = 0
    this.open()
  }

  close(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearReconnect()
    this.clearHeartbeat()
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
      ws.close(1000, 'client closed')
    }
    this.setState('closed', null)
  }

  private setState(state: ConnectionState, reason: string | null): void {
    this.state = state
    this.handlers.onState(state, { attempt: this.attempt, reason })
  }

  private open(): void {
    const encoded = encodeURIComponent(this.simulationId)
    const url = `${wsUrl(`/api/simulations/${encoded}/stream`)}?after_index=${this.handlers.resumeIndex()}`
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting', null)
    let ws: WebSocketLike
    try {
      ws = this.create(url)
    } catch {
      this.scheduleReconnect('The live stream could not be opened.')
      return
    }
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws) return
      this.attempt = 0
      this.setState('connected', null)
      this.armHeartbeat()
    }
    ws.onmessage = (message) => {
      if (this.ws !== ws) return
      this.armHeartbeat()
      this.handleMessage(message.data)
    }
    ws.onerror = () => {
      // A close event always follows; reconnection is handled there.
    }
    ws.onclose = (event) => {
      if (this.ws !== ws) return
      this.ws = null
      this.clearHeartbeat()
      this.handleClose(event.code, event.reason)
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') {
      this.handlers.onRejected('malformed', 'Binary frame')
      return
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(data)
    } catch {
      this.handlers.onRejected('malformed', 'Message is not valid JSON')
      return
    }
    let parsed: ReturnType<typeof parseMessage>
    try {
      parsed = parseMessage(decoded)
    } catch (error) {
      this.handlers.onRejected('malformed', error instanceof Error ? error.message : 'Invalid message')
      return
    }
    if (parsed.kind === 'unknown') {
      this.handlers.onRejected('unknown', parsed.type)
      return
    }
    if (parsed.event.simulation_id !== this.simulationId) {
      this.handlers.onRejected('foreign', parsed.event.simulation_id)
      return
    }
    if (TERMINAL_EVENTS.has(parsed.event.type)) this.finished = true
    if (parsed.event.type === 'snapshot' && ['completed', 'failed', 'cancelled'].includes(parsed.event.simulation.status)) {
      this.finished = true
    }
    this.handlers.onEvent(parsed.event)
  }

  private handleClose(code: number, reason: string): void {
    if (this.disposed) return
    if (this.finished || code === 1000) {
      this.setState('closed', null)
      return
    }
    if (code === 4404) {
      this.setState('failed', 'The engine does not know this simulation.')
      return
    }
    if (code === 4401) {
      this.setState('failed', 'Your session has ended. Sign in again to follow the run.')
      reportSessionLost(reason === 'session_expired' ? 'session_expired' : 'not_authenticated')
      return
    }
    if (code === 4403) {
      this.setState('failed', 'The engine refused the live stream from this address.')
      return
    }
    this.scheduleReconnect(reason ? `Connection reset: ${reason}.` : `Connection lost (code ${code}).`)
  }

  private scheduleReconnect(reason: string): void {
    if (this.disposed) return
    if (this.attempt >= this.maxAttempts) {
      this.setState('failed', reason)
      return
    }
    const delay = backoffDelay(this.attempt, this.baseDelay, this.maxDelay)
    this.attempt += 1
    this.setState('disconnected', reason)
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null
      if (!this.disposed) this.open()
    }, delay)
  }

  private armHeartbeat(): void {
    this.clearHeartbeat()
    this.heartbeatTimer = globalThis.setTimeout(() => {
      this.heartbeatTimer = null
      const ws = this.ws
      if (!ws) return
      this.ws = null
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
      ws.close(4002, 'heartbeat timeout')
      this.scheduleReconnect('No data from the engine within the heartbeat interval.')
    }, this.heartbeatTimeout)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) globalThis.clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) globalThis.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
}
