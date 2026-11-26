import type { ReactNode } from 'react'
import { Field } from './Field'
import type { FieldMessages } from './fieldA11y'
import { describedBy } from './fieldA11y'
import { NumberInput } from './NumberField'
import styles from './controls.module.css'

const LOG_STEPS = 1000

interface SliderFieldProps extends FieldMessages {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  scale?: 'linear' | 'log'
  unit?: string
  /** Formatted value with unit shown next to the label. */
  readout: ReactNode
  /** Plain-text value for screen readers. */
  valueText: string
  disabled?: boolean
}

function toPosition(value: number, min: number, max: number, scale: 'linear' | 'log'): number {
  if (!Number.isFinite(value)) return scale === 'log' ? 0 : min
  if (scale === 'linear') return Math.min(max, Math.max(min, value))
  if (value <= 0) return 0
  const lo = Math.log10(min)
  const hi = Math.log10(max)
  return Math.round(((Math.log10(Math.min(max, Math.max(min, value))) - lo) / (hi - lo)) * LOG_STEPS)
}

function fromPosition(position: number, min: number, max: number, scale: 'linear' | 'log'): number {
  if (scale === 'linear') return position
  const lo = Math.log10(min)
  const hi = Math.log10(max)
  const raw = 10 ** (lo + (position / LOG_STEPS) * (hi - lo))
  return Number(raw.toPrecision(3))
}

/**
 * Slider for continuous parameters with a synchronized numeric input. A log scale is used
 * for quantities spanning orders of magnitude; the numeric input accepts any value
 * (including 0 where the field allows it).
 */
export function SliderField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  scale = 'linear',
  unit,
  readout,
  valueText,
  disabled,
  error,
  warning,
  hint,
}: SliderFieldProps) {
  const logMin = scale === 'log' ? Math.max(min, max * 1e-9, Number.MIN_VALUE) : min
  const described = describedBy(id, { error, warning, hint })
  return (
    <Field id={id} label={label} readout={readout} error={error} warning={warning} hint={hint}>
      <div className={styles.controlRow}>
        <input
          className={styles.range}
          type="range"
          aria-label={`${label} slider`}
          aria-valuetext={valueText}
          aria-describedby={described}
          min={scale === 'log' ? 0 : min}
          max={scale === 'log' ? LOG_STEPS : max}
          step={scale === 'log' ? 1 : (step ?? 'any')}
          value={toPosition(value, logMin, max, scale)}
          disabled={disabled}
          onChange={(event) => {
            onChange(fromPosition(Number(event.target.value), logMin, max, scale))
          }}
        />
        <NumberInput
          id={id}
          value={value}
          onChange={onChange}
          unit={unit}
          disabled={disabled}
          invalid={Boolean(error)}
          describedBy={described}
        />
      </div>
    </Field>
  )
}
