/*
 * Centralized unit handling. Values arrive from the engine in SI units; conversion to a
 * display unit happens only here. Components never multiply by unit factors themselves.
 */
import {
  UNAVAILABLE,
  exponentOf,
  formatFixed,
  formatInteger,
  formatNumber,
  formatScientific,
  formatSignificant,
  isFiniteNumber,
  superscript,
  withSign,
} from './format'

export const M_S2_PER_MICROGAL = 1e-8
export const M_S2_PER_MILLIGAL = 1e-5

export type QuantityKind =
  | 'length'
  /** A distance stored in kilometres. */
  | 'length_km'
  | 'mass'
  | 'density'
  | 'gravity'
  | 'gravity_anomaly'
  | 'potential'
  | 'fractional'
  | 'frequency'
  | 'frequency_shift'
  | 'phase'
  | 'duration'
  | 'time'
  | 'temperature'
  | 'sigma'
  | 'percent'
  | 'count'
  | 'angle'
  | 'per_hour'
  | 'per_kelvin'
  | 'volume'
  | 'ratio'
  /** A fraction (0.12) displayed as a percentage (12.0 %). */
  | 'ratio_percent'

/** A display scale: displayed = value × factor, shown with `unit`. */
export interface DisplayScale {
  factor: number
  unit: string
}

const IDENTITY_UNITS: Partial<Record<QuantityKind, string>> = {
  length: 'm',
  mass: 'kg',
  density: 'kg/m³',
  gravity: 'm/s²',
  potential: 'm²/s²',
  phase: 'rad',
  time: 's',
  volume: 'm³',
}

export function gravityAnomalyScale(maxAbs: number): DisplayScale {
  return maxAbs >= 1000 * M_S2_PER_MICROGAL
    ? { factor: 1 / M_S2_PER_MILLIGAL, unit: 'mGal' }
    : { factor: 1 / M_S2_PER_MICROGAL, unit: 'µGal' }
}

const FREQUENCY_PREFIXES: [number, string][] = [
  [1e12, 'THz'],
  [1e9, 'GHz'],
  [1e6, 'MHz'],
  [1e3, 'kHz'],
  [1, 'Hz'],
  [1e-3, 'mHz'],
  [1e-6, 'µHz'],
  [1e-9, 'nHz'],
  [1e-12, 'pHz'],
]

export function frequencyScale(maxAbs: number): DisplayScale {
  for (const [size, unit] of FREQUENCY_PREFIXES) {
    if (maxAbs >= size) return { factor: 1 / size, unit }
  }
  return { factor: 1e12, unit: 'pHz' }
}

/** Power-of-ten scale for dimensionless or wide-range data: "× 10⁻¹⁸". */
export function powerScale(maxAbs: number, baseUnit = ''): DisplayScale {
  if (!isFiniteNumber(maxAbs) || maxAbs === 0) return { factor: 1, unit: baseUnit }
  const exponent = exponentOf(maxAbs)
  if (exponent >= -2 && exponent <= 3) return { factor: 1, unit: baseUnit }
  const label = `× 10${superscript(exponent)}`
  return { factor: 10 ** -exponent, unit: baseUnit ? `${label} ${baseUnit}` : label }
}

export function lengthScale(maxAbs: number): DisplayScale {
  return maxAbs >= 20_000 ? { factor: 1e-3, unit: 'km' } : { factor: 1, unit: 'm' }
}

/** Axis scale for a quantity given the largest magnitude in the data. */
export function scaleFor(kind: QuantityKind, maxAbs: number): DisplayScale {
  switch (kind) {
    case 'gravity_anomaly':
      return gravityAnomalyScale(maxAbs)
    case 'frequency':
    case 'frequency_shift':
      return frequencyScale(maxAbs)
    case 'length':
      return lengthScale(maxAbs)
    case 'fractional':
      return powerScale(maxAbs)
    case 'potential':
      return powerScale(maxAbs, 'm²/s²')
    case 'phase':
      return powerScale(maxAbs, 'rad')
    case 'gravity':
      return { factor: 1, unit: 'm/s²' }
    case 'duration':
    case 'time':
      return maxAbs >= 2 * 86_400
        ? { factor: 1 / 86_400, unit: 'd' }
        : maxAbs >= 2 * 3600
          ? { factor: 1 / 3600, unit: 'h' }
          : { factor: 1, unit: 's' }
    default:
      return { factor: 1, unit: IDENTITY_UNITS[kind] ?? '' }
  }
}

export function maxAbs(values: Iterable<number>): number {
  let max = 0
  for (const v of values) {
    if (Number.isFinite(v) && Math.abs(v) > max) max = Math.abs(v)
  }
  return max
}

function joinUnit(text: string, unit: string): string {
  if (!unit) return text
  if (unit === '°' || unit === 'σ') return `${text}${unit}`
  return `${text} ${unit}`
}

export interface FormatOptions {
  significant?: number
  signed?: boolean
}

function formatDuration(seconds: number): string {
  const abs = Math.abs(seconds)
  if (abs >= 2 * 86_400) return `${formatSignificant(seconds / 86_400, 3)} d`
  if (abs >= 2 * 3600) return `${formatSignificant(seconds / 3600, 3)} h`
  if (abs >= 120) return `${formatSignificant(seconds / 60, 3)} min`
  return `${formatSignificant(seconds, 3)} s`
}

/**
 * Formats a scientific quantity with its unit. Non-finite or missing values render as
 * "Unavailable"; they are never coerced to zero.
 */
export function formatQuantity(value: number | null | undefined, kind: QuantityKind, options: FormatOptions = {}): string {
  if (!isFiniteNumber(value)) return UNAVAILABLE
  const sig = options.significant
  let text: string
  switch (kind) {
    case 'length':
      text = joinUnit(formatNumber(value, sig ?? 4), 'm')
      break
    case 'length_km':
      text = joinUnit(formatNumber(value, sig ?? 4), 'km')
      break
    case 'mass':
      text = joinUnit(formatScientific(value, sig ?? 3), 'kg')
      break
    case 'volume':
      text = joinUnit(formatScientific(value, sig ?? 3), 'm³')
      break
    case 'density':
      text = joinUnit(formatNumber(value, sig ?? 4), 'kg/m³')
      break
    case 'gravity':
      text = joinUnit(formatFixed(value, 7), 'm/s²')
      break
    case 'gravity_anomaly': {
      const scale = gravityAnomalyScale(Math.abs(value))
      text = joinUnit(formatNumber(value * scale.factor, sig ?? 3), scale.unit)
      break
    }
    case 'potential':
      text = joinUnit(formatNumber(value, sig ?? 3), 'm²/s²')
      break
    case 'fractional':
      text = formatScientific(value, sig ?? 3)
      break
    case 'frequency':
      text = joinUnit(formatFixed(value, value >= 1e6 ? 1 : 3), 'Hz')
      break
    case 'frequency_shift': {
      const scale = frequencyScale(Math.abs(value))
      text = joinUnit(formatNumber(value * scale.factor, sig ?? 3), scale.unit)
      break
    }
    case 'phase':
      text = joinUnit(formatNumber(value, sig ?? 3), 'rad')
      break
    case 'duration':
      text = formatDuration(value)
      break
    case 'time':
      text = joinUnit(formatNumber(value, sig ?? 4), 's')
      break
    case 'temperature':
      text = Math.abs(value) < 1 && value !== 0 ? joinUnit(formatNumber(value * 1000, sig ?? 3), 'mK') : joinUnit(formatNumber(value, sig ?? 3), 'K')
      break
    case 'sigma':
      text = joinUnit(formatSignificant(value, sig ?? 2), 'σ')
      break
    case 'percent':
      text = joinUnit(formatFixed(value, 1), '%')
      break
    case 'count':
      text = formatInteger(value)
      break
    case 'ratio':
      text = formatSignificant(value, sig ?? 3)
      break
    case 'ratio_percent':
      text = joinUnit(formatFixed(value * 100, 1), '%')
      break
    case 'angle':
      text = joinUnit(formatFixed(value, 3), '°')
      break
    case 'per_hour':
      text = joinUnit(formatScientific(value, sig ?? 2), 'h⁻¹')
      break
    case 'per_kelvin':
      text = joinUnit(formatScientific(value, sig ?? 2), 'K⁻¹')
      break
  }
  return options.signed ? withSign(text, value) : text
}

/** Axis title with its unit, e.g. "Gravity anomaly (µGal)". */
export function axisTitle(label: string, scale: DisplayScale): string {
  return scale.unit ? `${label} (${scale.unit})` : label
}

