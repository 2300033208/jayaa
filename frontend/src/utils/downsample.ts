/**
 * Min/max envelope decimation for rendering only. Each bucket keeps its minimum and maximum
 * sample (in original order), so peaks and troughs survive and no value is invented.
 * The source arrays are never modified.
 */
export interface Decimated {
  indices: Int32Array
  reduced: boolean
  sourceLength: number
}

export function minMaxDecimate(y: ArrayLike<number>, maxPoints: number): Decimated {
  const n = y.length
  if (n <= maxPoints || maxPoints < 4) {
    const indices = new Int32Array(n)
    for (let i = 0; i < n; i += 1) indices[i] = i
    return { indices, reduced: false, sourceLength: n }
  }
  const buckets = Math.floor(maxPoints / 2)
  const size = n / buckets
  const out: number[] = []
  for (let b = 0; b < buckets; b += 1) {
    const start = Math.floor(b * size)
    const end = Math.min(n, Math.floor((b + 1) * size))
    let minI = -1
    let maxI = -1
    for (let i = start; i < end; i += 1) {
      const v = y[i]
      if (v === undefined || !Number.isFinite(v)) continue
      if (minI < 0 || v < (y[minI] ?? v)) minI = i
      if (maxI < 0 || v > (y[maxI] ?? v)) maxI = i
    }
    if (minI < 0) continue
    if (minI === maxI) out.push(minI)
    else if (minI < maxI) out.push(minI, maxI)
    else out.push(maxI, minI)
  }
  return { indices: Int32Array.from(out), reduced: true, sourceLength: n }
}

export function pick(source: ArrayLike<number>, indices: Int32Array, scale = 1): Float64Array {
  const out = new Float64Array(indices.length)
  for (let i = 0; i < indices.length; i += 1) out[i] = (source[indices[i] ?? 0] ?? Number.NaN) * scale
  return out
}
