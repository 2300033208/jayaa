import { describe, expect, it } from 'vitest'
import { MINUS, UNAVAILABLE, formatFixed, formatNumber, formatScientific, formatSignificant, superscript } from './format'
import { formatQuantity, gravityAnomalyScale, powerScale, scaleFor } from './units'

describe('scientific formatting', () => {
  it('formats small values with superscript exponents', () => {
    expect(formatScientific(1.23e-18)).toBe('1.23 × 10⁻¹⁸')
    expect(formatScientific(-2.4721e-18)).toBe(`${MINUS}2.47 × 10⁻¹⁸`)
    expect(formatScientific(9.996e-19, 3)).toBe('1.00 × 10⁻¹⁸')
    expect(formatScientific(5e12)).toBe('5.00 × 10¹²')
    expect(superscript(-18)).toBe('⁻¹⁸')
  })

  it('never renders NaN, Infinity or null as numbers', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatScientific(bad)).toBe(UNAVAILABLE)
      expect(formatFixed(bad, 2)).toBe(UNAVAILABLE)
      expect(formatQuantity(bad, 'length')).toBe(UNAVAILABLE)
    }
    expect(formatQuantity(null, 'mass')).toBe(UNAVAILABLE)
    expect(formatQuantity(undefined, 'gravity')).toBe(UNAVAILABLE)
  })

  it('keeps zero as a real value', () => {
    expect(formatQuantity(0, 'length')).toBe('0 m')
    expect(formatQuantity(0, 'fractional')).toBe('0')
  })

  it('groups digits with thin spaces and uses a true minus sign', () => {
    expect(formatFixed(429228004229873, 0)).toBe('429 228 004 229 873')
    expect(formatFixed(-1500, 0)).toBe(`${MINUS}1500`)
    expect(formatSignificant(1498.7, 3)).toBe('1500')
    expect(formatNumber(0.00444, 3)).toBe('0.00444')
    expect(formatNumber(2e-4, 3)).toBe('2.00 × 10⁻⁴')
  })
})

describe('units', () => {
  it('attaches explicit units to every quantity kind', () => {
    expect(formatQuantity(102.4, 'length')).toBe('102.4 m')
    expect(formatQuantity(9.806123, 'gravity')).toBe('9.8061230 m/s²')
    expect(formatQuantity(3.2e-8, 'gravity_anomaly')).toBe('3.20 µGal')
    expect(formatQuantity(1.48e-4, 'gravity_anomaly')).toBe('14.8 mGal')
    expect(formatQuantity(1.23e-18, 'fractional')).toBe('1.23 × 10⁻¹⁸')
    expect(formatQuantity(0.42, 'phase')).toBe('0.420 rad')
    expect(formatQuantity(7800, 'density')).toBe('7800 kg/m³')
    expect(formatQuantity(5e9, 'mass')).toBe('5.00 × 10⁹ kg')
    expect(formatQuantity(0.003, 'temperature')).toBe('3.00 mK')
    expect(formatQuantity(1142900, 'duration')).toBe('13.2 d')
    expect(formatQuantity(7.25, 'sigma')).toBe('7.3σ')
    expect(formatQuantity(0.0282, 'ratio_percent')).toBe('2.8 %')
  })

  it('formats signed errors', () => {
    expect(formatQuantity(2, 'length', { signed: true })).toBe('+2.000 m')
    expect(formatQuantity(-1.6, 'percent', { signed: true })).toBe(`${MINUS}1.6 %`)
  })

  it('chooses display scales centrally', () => {
    expect(gravityAnomalyScale(5e-7)).toEqual({ factor: 1e8, unit: 'µGal' })
    expect(gravityAnomalyScale(2e-5).unit).toBe('mGal')
    const p = powerScale(2.4e-18)
    expect(p.unit).toBe('× 10⁻¹⁸')
    expect(2.4e-18 * p.factor).toBeCloseTo(2.4, 10)
    expect(scaleFor('length', 272_000)).toEqual({ factor: 1e-3, unit: 'km' })
    expect(scaleFor('frequency_shift', 4e-4).unit).toBe('µHz')
  })
})
