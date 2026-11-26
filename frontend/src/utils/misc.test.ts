import { describe, expect, it } from 'vitest'
import { editableText, parseNumberInput } from '../components/controls/numberText'
import { minMaxDecimate } from './downsample'
import { deepEqual, stableStringify } from './misc'
import { readStored, removeStored, writeStored } from './storage'

describe('min/max decimation (display only)', () => {
  it('keeps every sample below the cap', () => {
    const d = minMaxDecimate([1, 2, 3], 100)
    expect(d.reduced).toBe(false)
    expect(Array.from(d.indices)).toEqual([0, 1, 2])
  })

  it('preserves extremes and never modifies the source array', () => {
    const y = Array.from({ length: 10_000 }, (_, i) => Math.sin(i / 50))
    y[4321] = 50
    y[777] = -50
    const copy = [...y]
    const d = minMaxDecimate(y, 400)
    expect(d.reduced).toBe(true)
    expect(d.indices.length).toBeLessThanOrEqual(400)
    expect(Array.from(d.indices)).toContain(4321)
    expect(Array.from(d.indices)).toContain(777)
    expect(y).toEqual(copy)
  })
})

describe('numeric input', () => {
  it('parses scientific and localized forms, rejecting junk as NaN (never 0)', () => {
    expect(parseNumberInput('5e12')).toBe(5e12)
    expect(parseNumberInput('−1500')).toBe(-1500)
    expect(parseNumberInput('1 500')).toBe(1500)
    expect(parseNumberInput('2.5×10^-19')).toBe(2.5e-19)
    expect(parseNumberInput('')).toBeNaN()
    expect(parseNumberInput('abc')).toBeNaN()
    expect(parseNumberInput('1e400')).toBe(Number.POSITIVE_INFINITY)
  })

  it('renders exact integers in full and tiny values in e-notation', () => {
    expect(editableText(20260926)).toBe('20260926')
    expect(editableText(429228004229873, 'plain')).toBe('429228004229873')
    expect(editableText(1e-17)).toBe('1e-17')
    expect(editableText(Number.NaN)).toBe('')
  })
})

describe('stable structural equality', () => {
  it('ignores key order and distinguishes NaN from numbers', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}')
    expect(deepEqual({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true)
    expect(deepEqual({ x: Number.NaN }, { x: 0 })).toBe(false)
  })
})

describe('local storage safety', () => {
  const isString = (v: unknown): v is string => typeof v === 'string'

  it('round-trips valid data', () => {
    writeStored('k', 'value')
    expect(readStored('k', isString)).toBe('value')
    removeStored('k')
    expect(readStored('k', isString)).toBeNull()
  })

  it('discards corrupted JSON, wrong schema, invalid values and expired entries', () => {
    window.localStorage.setItem('ags:bad', '{not json')
    expect(readStored('bad', isString)).toBeNull()
    expect(window.localStorage.getItem('ags:bad')).toBeNull()
    window.localStorage.setItem('ags:schema', JSON.stringify({ v: 99, savedAt: Date.now(), value: 'x' }))
    expect(readStored('schema', isString)).toBeNull()
    writeStored('num', 42)
    expect(readStored('num', isString)).toBeNull()
    window.localStorage.setItem('ags:old', JSON.stringify({ v: 1, savedAt: Date.now() - 10_000, value: 'x' }))
    expect(readStored('old', isString, 1000)).toBeNull()
  })
})
