import type { ReactNode } from 'react'
import { SliderField } from '../../components/controls/SliderField'
import type { QuantityKind } from '../../utils/units'
import { formatQuantity } from '../../utils/units'
import { fieldId } from './fieldId'
import { specFor } from './validation'

interface SpecSliderProps {
  /** Concrete field path, e.g. "bodies.0.depth_m". Limits, label and unit come from the shared contract. */
  path: string
  value: number
  onChange: (value: number) => void
  kind: QuantityKind
  scale?: 'linear' | 'log'
  label?: string
  /** Slider range override for usability; typed input still accepts the full valid range. */
  sliderMin?: number
  sliderMax?: number
  step?: number
  error?: string | undefined
  warning?: string | undefined
  hint?: ReactNode
  disabled?: boolean
}

export function SpecSlider({ path, value, onChange, kind, scale = 'linear', label, sliderMin, sliderMax, step, error, warning, hint, disabled }: SpecSliderProps) {
  const spec = specFor(path)
  if (spec === null) throw new Error(`No field spec for ${path}`)
  const readout = formatQuantity(value, kind)
  return (
    <SliderField
      id={fieldId(path)}
      label={label ?? spec.label}
      value={value}
      onChange={onChange}
      min={sliderMin ?? spec.min}
      max={sliderMax ?? spec.max}
      step={step}
      scale={scale}
      unit={spec.unit}
      readout={readout}
      valueText={readout}
      error={error}
      warning={warning}
      hint={hint}
      disabled={disabled}
    />
  )
}
