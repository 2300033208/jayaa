import { describe, expect, it } from 'vitest'
import { row } from '../../test/fixtures'
import { MeasurementBuffer } from './measurementBuffer'

describe('MeasurementBuffer', () => {
  it('appends in order and grows without losing data', () => {
    const buffer = new MeasurementBuffer(16)
    buffer.append(Array.from({ length: 1000 }, (_, i) => row(i)))
    expect(buffer.length).toBe(1000)
    expect(buffer.column('index')[999]).toBe(999)
    expect(buffer.lastIndex).toBe(999)
  })

  it('never stores a replayed measurement twice', () => {
    const buffer = new MeasurementBuffer()
    buffer.append([row(0), row(1), row(2)])
    const accepted = buffer.append([row(1), row(2), row(3)])
    expect(accepted).toBe(1)
    expect(buffer.length).toBe(4)
    expect(buffer.duplicates).toBe(2)
  })

  it('records gaps without blocking later data', () => {
    const buffer = new MeasurementBuffer()
    buffer.append([row(0), row(3)])
    expect(buffer.length).toBe(2)
    expect(buffer.gaps).toBe(2)
    expect(buffer.lastIndex).toBe(3)
  })

  it('round-trips an unavailable z-score as null (never zero)', () => {
    const buffer = new MeasurementBuffer()
    buffer.append([row(0), row(5)])
    expect(buffer.row(0)?.z_score).toBeNull()
    expect(buffer.row(1)?.z_score).toBe(0.5)
    expect(buffer.row(7)).toBeNull()
  })

  it('handles 100 000 measurements quickly', () => {
    const rows = Array.from({ length: 100_000 }, (_, i) => row(i))
    const buffer = new MeasurementBuffer()
    const t0 = performance.now()
    for (let i = 0; i < rows.length; i += 2000) buffer.append(rows.slice(i, i + 2000))
    expect(buffer.length).toBe(100_000)
    expect(performance.now() - t0).toBeLessThan(1500)
  })
})
