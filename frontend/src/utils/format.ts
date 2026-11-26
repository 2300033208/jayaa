/*
 * Number formatting for display. These functions only produce strings; they never
 * modify the underlying values.
 */

export const MINUS = '−'
export const THIN_SPACE = ' '
export const UNAVAILABLE = 'Unavailable'

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function superscript(n: number): string {
  return String(n)
    .split('')
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join('')
}

function withMinus(text: string): string {
  return text.startsWith('-') ? `${MINUS}${text.slice(1)}` : text
}

function groupDigits(integerPart: string): string {
  if (integerPart.length <= 4) return integerPart
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)
}

/** Fixed decimals with thin-space digit grouping and a true minus sign. */
export function formatFixed(value: number, decimals: number): string {
  if (!isFiniteNumber(value)) return UNAVAILABLE
  const text = Math.abs(value).toFixed(Math.max(0, Math.min(decimals, 20)))
  const [intPart = '0', frac] = text.split('.')
  const negative = value < 0 && Number(text) !== 0
  const body = frac === undefined ? groupDigits(intPart) : `${groupDigits(intPart)}.${frac}`
  return negative ? `${MINUS}${body}` : body
}

/** Exponent of the leading digit, e.g. 2.4e-18 → −18. */
export function exponentOf(value: number): number {
  return value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value)))
}

/** Scientific notation with Unicode superscripts: 1.23 × 10⁻¹⁸. */
export function formatScientific(value: number, significant = 3): string {
  if (!isFiniteNumber(value)) return UNAVAILABLE
  if (value === 0) return '0'
  let exponent = exponentOf(value)
  let mantissa = (value / 10 ** exponent).toFixed(Math.max(0, significant - 1))
  if (Math.abs(Number(mantissa)) >= 10) {
    exponent += 1
    mantissa = (value / 10 ** exponent).toFixed(Math.max(0, significant - 1))
  }
  if (exponent === 0) return withMinus(mantissa)
  return `${withMinus(mantissa)} × 10${superscript(exponent)}`
}

/** Significant-figure formatting in fixed notation. */
export function formatSignificant(value: number, significant = 4): string {
  if (!isFiniteNumber(value)) return UNAVAILABLE
  if (value === 0) return '0'
  const decimals = Math.max(0, significant - 1 - exponentOf(value))
  return formatFixed(Number(value.toPrecision(significant)), Math.min(decimals, 12))
}

/** Fixed notation for ordinary magnitudes, scientific outside [1e-3, 1e6). */
export function formatNumber(value: number, significant = 4): string {
  if (!isFiniteNumber(value)) return UNAVAILABLE
  const magnitude = Math.abs(value)
  if (magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e6)) return formatScientific(value, significant)
  return formatSignificant(value, significant)
}

export function withSign(text: string, value: number): string {
  return value > 0 ? `+${text}` : text
}

export function formatInteger(value: number): string {
  if (!isFiniteNumber(value)) return UNAVAILABLE
  return formatFixed(Math.round(value), 0)
}

export function formatPercent(value: number, decimals = 1): string {
  if (!isFiniteNumber(value)) return UNAVAILABLE
  return `${formatFixed(value, decimals)} %`
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return UNAVAILABLE
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
