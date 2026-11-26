import type { MeasurementField, MeasurementRow } from '../../types/api'
import { MEASUREMENT_FIELDS } from '../../types/api'

/**
 * Append-only columnar store for streamed measurements. The original values are kept at
 * full precision for the whole run; charts and the 3D scene read views of these arrays.
 *
 * Deduplication: rows are accepted only when their index is at or beyond the next expected
 * index, so a replayed or duplicated message can never add a point twice. A missing index
 * (a row rejected by validation upstream) is counted as a gap rather than blocking the stream.
 *
 * `z_score` may legitimately be unavailable; it is stored as NaN internally and converted back
 * to null by `row()`. Consumers of `column('z_score')` must treat non-finite values as missing.
 */
export class MeasurementBuffer {
  private columns: Record<MeasurementField, Float64Array>
  private capacity: number
  private size = 0
  private expected = 0
  private gapCount = 0
  private duplicateCount = 0

  constructor(initialCapacity = 1024) {
    this.capacity = Math.max(16, initialCapacity)
    this.columns = MeasurementBuffer.allocate(this.capacity)
  }

  private static allocate(capacity: number): Record<MeasurementField, Float64Array> {
    const out = {} as Record<MeasurementField, Float64Array>
    for (const field of MEASUREMENT_FIELDS) out[field] = new Float64Array(capacity)
    return out
  }

  get length(): number {
    return this.size
  }

  /** Index to request replay after (−1 when empty). */
  get lastIndex(): number {
    return this.expected - 1
  }

  get gaps(): number {
    return this.gapCount
  }

  get duplicates(): number {
    return this.duplicateCount
  }

  private grow(minimum: number): void {
    let capacity = this.capacity
    while (capacity < minimum) capacity *= 2
    const next = MeasurementBuffer.allocate(capacity)
    for (const field of MEASUREMENT_FIELDS) next[field].set(this.columns[field].subarray(0, this.size))
    this.columns = next
    this.capacity = capacity
  }

  /** Appends rows in index order; returns how many were accepted. */
  append(rows: readonly MeasurementRow[]): number {
    if (rows.length === 0) return 0
    if (this.size + rows.length > this.capacity) this.grow(this.size + rows.length)
    let accepted = 0
    for (const row of rows) {
      if (row.index < this.expected) {
        this.duplicateCount += 1
        continue
      }
      if (row.index > this.expected) this.gapCount += row.index - this.expected
      const at = this.size
      for (const field of MEASUREMENT_FIELDS) {
        const value = row[field]
        this.columns[field][at] = value ?? Number.NaN
      }
      this.size += 1
      this.expected = row.index + 1
      accepted += 1
    }
    return accepted
  }

  column(field: MeasurementField): Float64Array {
    return this.columns[field].subarray(0, this.size)
  }

  row(position: number): MeasurementRow | null {
    if (position < 0 || position >= this.size) return null
    const out: Record<string, number | null> = {}
    for (const field of MEASUREMENT_FIELDS) {
      const value = this.columns[field][position] ?? Number.NaN
      out[field] = field === 'z_score' && !Number.isFinite(value) ? null : value
    }
    return out as MeasurementRow
  }

  latest(): MeasurementRow | null {
    return this.row(this.size - 1)
  }

  clear(): void {
    this.size = 0
    this.expected = 0
    this.gapCount = 0
    this.duplicateCount = 0
  }
}
