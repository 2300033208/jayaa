import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSocket } from '../test/fakeSocket'
import { OTHER_SIM_ID, SIM_ID, batchEvent, row, statusJson, summaryJson } from '../test/fixtures'
import type { SimulationEvent } from '../types/api'
import type { ConnectionState, RejectionKind } from './socket'
import { SimulationSocket } from './socket'

function setup(resume = () => -1) {
  const events: SimulationEvent[] = []
  const states: ConnectionState[] = []
  const rejected: RejectionKind[] = []
  const socket = new SimulationSocket(
    SIM_ID,
    {
      onEvent: (e) => events.push(e),
      onState: (s) => states.push(s),
      onRejected: (k) => rejected.push(k),
      resumeIndex: resume,
    },
    { createSocket: (url) => new FakeSocket(url), baseDelayMs: 100, maxDelayMs: 100, maxReconnectAttempts: 3, heartbeatTimeoutMs: 5000 },
  )
  return { socket, events, states, rejected }
}

beforeEach(() => {
  FakeSocket.reset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SimulationSocket', () => {
  it('connects once and delivers validated events', () => {
    const { socket, events, states } = setup()
    socket.connect()
    socket.connect()
    expect(FakeSocket.instances).toHaveLength(1)
    FakeSocket.latest().open()
    FakeSocket.latest().send(batchEvent(2, [row(0), row(1)]))
    expect(states).toEqual(['connecting', 'connected'])
    expect(events[0]?.type).toBe('measurement_batch')
    expect(FakeSocket.latest().url).toContain('after_index=-1')
  })

  it('ignores unknown, malformed and foreign messages without crashing', () => {
    const { socket, events, rejected } = setup()
    socket.connect()
    const ws = FakeSocket.latest()
    ws.open()
    ws.send('{not json')
    ws.send({ type: 'from_the_future', simulation_id: SIM_ID, seq: 1 })
    ws.send({ type: 'heartbeat' })
    ws.send({ type: 'heartbeat', simulation_id: OTHER_SIM_ID, seq: 1 })
    ws.send({ type: 'heartbeat', simulation_id: SIM_ID, seq: 2 })
    expect(rejected).toEqual(['malformed', 'unknown', 'malformed', 'foreign'])
    expect(events.map((e) => e.type)).toEqual(['heartbeat'])
  })

  it('reconnects with backoff and resumes after the last received index', () => {
    let last = -1
    const { socket, states } = setup(() => last)
    socket.connect()
    FakeSocket.latest().open()
    last = 41
    FakeSocket.latest().drop(1006)
    expect(states.at(-1)).toBe('disconnected')
    vi.advanceTimersByTime(150)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(FakeSocket.latest().url).toContain('after_index=41')
    expect(states.at(-1)).toBe('reconnecting')
    FakeSocket.latest().open()
    expect(states.at(-1)).toBe('connected')
  })

  it('ignores callbacks from a superseded socket', () => {
    const { socket, events } = setup()
    socket.connect()
    const first = FakeSocket.latest()
    first.open()
    first.drop(1006)
    vi.advanceTimersByTime(150)
    first.send({ type: 'heartbeat', simulation_id: SIM_ID, seq: 9 })
    expect(events).toHaveLength(0)
  })

  it('gives up after bounded attempts and can be retried manually', () => {
    const { socket, states } = setup()
    socket.connect()
    for (let i = 0; i < 4; i += 1) {
      FakeSocket.latest().drop(1006)
      vi.advanceTimersByTime(200)
    }
    expect(states.at(-1)).toBe('failed')
    const count = FakeSocket.instances.length
    socket.retry()
    expect(FakeSocket.instances.length).toBe(count + 1)
  })

  it('treats a missing heartbeat as a dead connection', () => {
    const { socket, states } = setup()
    socket.connect()
    FakeSocket.latest().open()
    vi.advanceTimersByTime(5001)
    expect(FakeSocket.instances[0]?.closed).toBe(true)
    expect(states).toContain('disconnected')
  })

  it('closes cleanly after a terminal event and does not reconnect', () => {
    const { socket, states } = setup()
    socket.connect()
    const ws = FakeSocket.latest()
    ws.open()
    ws.send({ type: 'simulation_completed', simulation_id: SIM_ID, seq: 5, simulation: statusJson({ status: 'completed', phase: 'complete', stage: 'complete', progress: 1, results_available: true }), summary: summaryJson })
    ws.drop(1000)
    vi.advanceTimersByTime(1000)
    expect(states.at(-1)).toBe('closed')
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('reports an unknown simulation as failed', () => {
    const { socket, states } = setup()
    socket.connect()
    FakeSocket.latest().drop(4404, 'Simulation not found')
    expect(states.at(-1)).toBe('failed')
  })

  it('close() stops timers and further events', () => {
    const { socket, events } = setup()
    socket.connect()
    const ws = FakeSocket.latest()
    ws.open()
    socket.close()
    ws.send({ type: 'heartbeat', simulation_id: SIM_ID, seq: 1 })
    vi.advanceTimersByTime(60_000)
    expect(events).toHaveLength(0)
    expect(FakeSocket.instances).toHaveLength(1)
  })
})
