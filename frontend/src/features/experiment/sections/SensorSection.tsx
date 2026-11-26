import { Field } from '../../../components/controls/Field'
import { describedBy } from '../../../components/controls/fieldA11y'
import { NumberInput } from '../../../components/controls/NumberField'
import { SegmentedField, SelectField } from '../../../components/controls/Choice'
import type { ClockSpecies, PerformanceClass, SensorConfig } from '../../../types/config'
import { formatQuantity } from '../../../utils/units'
import { fieldId } from '../fieldId'
import { CLOCK_PRESETS, PERFORMANCE_CLASSES_INFO, PERFORMANCE_NOTE, PRESET_NOTE, performanceFor } from '../limits'
import { SpecSlider } from '../SpecSlider'
import { FormSection } from './FormSection'
import type { SectionProps } from './types'

const SPECIES_OPTIONS: { value: ClockSpecies; label: string }[] = [
  ...CLOCK_PRESETS.map((p) => ({ value: p.id, label: p.label })),
  { value: 'custom', label: 'Custom clock' },
]

const PERFORMANCE_OPTIONS: { value: PerformanceClass; label: string }[] = [
  ...PERFORMANCE_CLASSES_INFO.map((c) => ({ value: c.id, label: c.label })),
  { value: 'custom', label: 'Custom performance' },
]

/** Stability, systematic uncertainty and uptime of a species in a named class (unchanged for custom). */
function performancePatch(species: ClockSpecies, performanceClass: PerformanceClass): Partial<SensorConfig> {
  const values = performanceFor(species, performanceClass)
  return values
    ? { stability_1s: values.stability_1s, systematic_uncertainty: values.systematic_uncertainty, uptime_percent: values.uptime_percent }
    : {}
}

export function SensorSection({ config, edit, errors, warnings, disabled }: SectionProps) {
  const sensor = config.sensor
  const set = (patch: Partial<SensorConfig>) => {
    edit((c) => ({ ...c, sensor: { ...c.sensor, ...patch } }))
  }
  const custom = sensor.clock_species === 'custom'
  const freqId = fieldId('sensor.reference_frequency_hz')
  const bbrId = fieldId('sensor.bbr_sensitivity_per_k')
  const freqError = errors['sensor.reference_frequency_hz']
  const bbrError = errors['sensor.bbr_sensitivity_per_k']
  const freqHint = custom ? 'Transition frequency of the custom clock.' : 'Set by the selected clock species.'
  const bbrHint = custom ? 'Fractional frequency change per kelvin at 300 K.' : PRESET_NOTE
  const customPerformance = sensor.performance_class === 'custom'
  const classInfo = PERFORMANCE_CLASSES_INFO.find((c) => c.id === sensor.performance_class)
  const values = performanceFor(sensor.clock_species, sensor.performance_class)
  const performanceHint = values && classInfo ? `${classInfo.description} ${values.basis}` : PERFORMANCE_NOTE
  const fixedHint = 'Set by the selected performance class.'

  return (
    <FormSection
      id="sensor"
      step={3}
      title="Sensor"
      description="Optical clock that converts gravitational potential into a frequency shift: Δf/f₀ = ΔΦ/c²."
    >
      <SegmentedField
        id={fieldId('sensor.mode')}
        label="Sensor mode"
        value={sensor.mode}
        options={[
          { value: 'local_reference', label: 'Local reference clock' },
          { value: 'remote_reference', label: 'Remote reference' },
        ]}
        onChange={(mode) => {
          set({ mode })
        }}
        disabled={disabled}
        hint={
          sensor.mode === 'local_reference'
            ? 'Compared with a reference clock at the first survey point; 90 % of environmental noise is common-mode.'
            : 'Compared with a distant reference via fibre link; measures the full potential difference to the reference surface.'
        }
      />
      {sensor.mode === 'remote_reference' && (
        <SpecSlider
          path="sensor.reference_distance_km"
          value={sensor.reference_distance_km}
          onChange={(reference_distance_km) => {
            set({ reference_distance_km })
          }}
          kind="length_km"
          step={1}
          error={errors['sensor.reference_distance_km']}
          hint="Distance to the fibre-linked reference laboratory (placed due north). Distant clocks see different tides."
          disabled={disabled}
        />
      )}
      <SelectField
        id={fieldId('sensor.clock_species')}
        label="Clock species"
        value={sensor.clock_species}
        options={SPECIES_OPTIONS}
        disabled={disabled}
        error={errors['sensor.clock_species']}
        onChange={(clock_species) => {
          const preset = CLOCK_PRESETS.find((p) => p.id === clock_species)
          if (!preset) {
            // A custom clock has no published performance: keep the current values, editable.
            set({ clock_species, performance_class: 'custom' })
            return
          }
          set({
            clock_species,
            reference_frequency_hz: preset.reference_frequency_hz,
            bbr_sensitivity_per_k: preset.bbr_sensitivity_per_k,
            ...performancePatch(clock_species, sensor.performance_class),
          })
        }}
      />
      <SelectField
        id={fieldId('sensor.performance_class')}
        label="Performance class"
        value={sensor.performance_class}
        options={PERFORMANCE_OPTIONS.map((o) => ({ ...o, disabled: custom && o.value !== 'custom' }))}
        disabled={disabled}
        error={errors['sensor.performance_class']}
        warning={warnings['sensor.performance_class']}
        hint={performanceHint}
        onChange={(performance_class) => {
          set({ performance_class, ...performancePatch(sensor.clock_species, performance_class) })
        }}
      />
      <Field id={freqId} label="Reference frequency" readout={formatQuantity(sensor.reference_frequency_hz, 'frequency')} error={freqError} hint={freqHint}>
        <NumberInput
          id={freqId}
          value={sensor.reference_frequency_hz}
          onChange={(reference_frequency_hz) => {
            set({ reference_frequency_hz })
          }}
          unit="Hz"
          notation="plain"
          disabled={disabled || !custom}
          invalid={Boolean(freqError)}
          describedBy={describedBy(freqId, { error: freqError, hint: freqHint })}
        />
      </Field>
      <Field id={bbrId} label="Blackbody sensitivity" readout={formatQuantity(sensor.bbr_sensitivity_per_k, 'per_kelvin')} error={bbrError} hint={bbrHint}>
        <NumberInput
          id={bbrId}
          value={sensor.bbr_sensitivity_per_k}
          onChange={(bbr_sensitivity_per_k) => {
            set({ bbr_sensitivity_per_k })
          }}
          unit="K⁻¹"
          disabled={disabled || !custom}
          invalid={Boolean(bbrError)}
          describedBy={describedBy(bbrId, { error: bbrError, hint: bbrHint })}
        />
      </Field>
      <SpecSlider
        path="sensor.measurement_interval_s"
        value={sensor.measurement_interval_s}
        onChange={(measurement_interval_s) => {
          set({ measurement_interval_s })
        }}
        kind="duration"
        scale="log"
        error={errors['sensor.measurement_interval_s']}
        hint="Clock-comparison averaging at each station while the clock runs. With uptime below 100 % it takes longer in wall-clock time."
        disabled={disabled}
      />
      <SpecSlider
        path="sensor.stability_1s"
        label="Sensor stability σᵧ(1 s)"
        value={sensor.stability_1s}
        onChange={(stability_1s) => {
          set({ stability_1s })
        }}
        kind="fractional"
        scale="log"
        error={errors['sensor.stability_1s']}
        warning={warnings['sensor.stability_1s']}
        hint={customPerformance ? 'Allan deviation of one clock at 1 s; averages down as 1/√τ.' : fixedHint}
        disabled={disabled || !customPerformance}
      />
      <SpecSlider
        path="sensor.systematic_uncertainty"
        value={sensor.systematic_uncertainty}
        onChange={(systematic_uncertainty) => {
          set({ systematic_uncertainty })
        }}
        kind="fractional"
        scale="log"
        sliderMin={1e-20}
        error={errors['sensor.systematic_uncertainty']}
        hint={
          customPerformance
            ? 'Residual systematic shift incurred again at every station set-up; does not average down. Enter 0 to disable.'
            : fixedHint
        }
        disabled={disabled || !customPerformance}
      />
      <SpecSlider
        path="sensor.uptime_percent"
        value={sensor.uptime_percent}
        onChange={(uptime_percent) => {
          set({ uptime_percent })
        }}
        kind="percent"
        error={errors['sensor.uptime_percent']}
        hint={customPerformance ? 'Fraction of time the clock produces valid data.' : fixedHint}
        disabled={disabled || !customPerformance}
      />
    </FormSection>
  )
}
