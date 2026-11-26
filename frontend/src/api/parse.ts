/*
 * Runtime validation for data crossing the network boundary. Nothing from the engine
 * reaches charts or the 3D scene without passing through these parsers: non-finite
 * numbers, missing fields, unexpected nulls and unknown enum values are rejected.
 */

export class ParseError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'ParseError'
    this.path = path
  }
}

export type Parser<T> = (value: unknown, path: string) => T

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
  return typeof value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const finite: Parser<number> = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ParseError(path, `expected a finite number, got ${describe(value)}`)
  }
  return value
}

export const integer: Parser<number> = (value, path) => {
  const n = finite(value, path)
  if (!Number.isInteger(n)) throw new ParseError(path, 'expected an integer')
  return n
}

export const nonNegativeInteger: Parser<number> = (value, path) => {
  const n = integer(value, path)
  if (n < 0) throw new ParseError(path, 'expected a non-negative integer')
  return n
}

export const fraction: Parser<number> = (value, path) => {
  const n = finite(value, path)
  if (n < 0 || n > 1) throw new ParseError(path, 'expected a value between 0 and 1')
  return n
}

export const string: Parser<string> = (value, path) => {
  if (typeof value !== 'string') throw new ParseError(path, `expected a string, got ${describe(value)}`)
  return value
}

export const boolean: Parser<boolean> = (value, path) => {
  if (typeof value !== 'boolean') throw new ParseError(path, `expected a boolean, got ${describe(value)}`)
  return value
}

export function literal<const T extends string>(values: readonly T[]): Parser<T> {
  return (value, path) => {
    if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
      throw new ParseError(path, `expected one of ${values.join(', ')}`)
    }
    return value as T
  }
}

export function nullable<T>(parser: Parser<T>): Parser<T | null> {
  return (value, path) => (value === null ? null : parser(value, path))
}

export function array<T>(item: Parser<T>): Parser<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) throw new ParseError(path, `expected an array, got ${describe(value)}`)
    const out: T[] = new Array<T>(value.length)
    for (let i = 0; i < value.length; i += 1) out[i] = item(value[i], `${path}[${i}]`)
    return out
  }
}

/** Fast path for large numeric arrays. */
export const finiteArray: Parser<number[]> = (value, path) => {
  if (!Array.isArray(value)) throw new ParseError(path, `expected an array, got ${describe(value)}`)
  for (let i = 0; i < value.length; i += 1) {
    const v: unknown = value[i]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new ParseError(`${path}[${i}]`, `expected a finite number, got ${describe(v)}`)
    }
  }
  return value as number[]
}

export function matrix(rows: number, cols: number): Parser<number[][]> {
  return (value, path) => {
    const out = array(finiteArray)(value, path)
    if (out.length !== rows) throw new ParseError(path, `expected ${rows} rows, got ${out.length}`)
    out.forEach((row, i) => {
      if (row.length !== cols) throw new ParseError(`${path}[${i}]`, `expected ${cols} columns, got ${row.length}`)
    })
    return out
  }
}

export type Shape<T> = { [K in keyof T]-?: Parser<T[K]> }

/** Validates an object against a shape. Unknown keys are ignored (forward compatible). */
export function object<T>(shape: Shape<T>): Parser<T> {
  return (value, path) => {
    if (!isRecord(value)) throw new ParseError(path, `expected an object, got ${describe(value)}`)
    const out: Partial<T> = {}
    for (const key of Object.keys(shape) as (keyof T & string)[]) {
      out[key] = shape[key](value[key], `${path}.${key}`)
    }
    return out as T
  }
}

export function record<K extends string, V>(keys: readonly K[], item: Parser<V>): Parser<Record<K, V>> {
  return (value, path) => {
    if (!isRecord(value)) throw new ParseError(path, `expected an object, got ${describe(value)}`)
    const out: Partial<Record<K, V>> = {}
    for (const key of keys) out[key] = item(value[key], `${path}.${key}`)
    return out as Record<K, V>
  }
}

export function refine<T>(parser: Parser<T>, check: (value: T) => string | null): Parser<T> {
  return (value, path) => {
    const parsed = parser(value, path)
    const problem = check(parsed)
    if (problem !== null) throw new ParseError(path, problem)
    return parsed
  }
}
