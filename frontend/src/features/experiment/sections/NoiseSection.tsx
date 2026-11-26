import { Shuffle } from 'lucide-react'
import { Button } from '../../../components/controls/Button'
import { Field } from '../../../components/controls/Field'
import { describedBy } from '../../../components/controls/fieldA11y'
import { NumberInput } from '../../../components/controls/NumberField'
import type { NoiseConfig } from '../../../types/config'
import { formatQuantity } from '../../../utils/units'
import { fieldId } from '../fieldId'
import { SpecSlider } from '../SpecSlider'
import { FormSection } from './FormSection'
import type { SectionProps } from './types'
import styles from './form.module.css'

export function NoiseSection({ config, edit, errors, warnings, disabled }: SectionProps) {
  const noise = config.noise
  const set = (patch: Partial<NoiseConfig>) => {
    edit((c) => ({ ...c, noise: { ...c.noise, ...patch } }))
  }
  const driftId = fieldId('noise.frequency_drift_per_hour')
  const seedId = fieldId('noise.seed')
  const driftError = errors['noise.frequency_drift_per_hour']
  const seedError = errors['noise.seed']
  const driftHint = 'Linear clock drift (signed). Estimated and removed jointly by the inversion.'
  const seedHint = 'Same seed and configuration reproduce identical measurements.'

  return (
    <FormSection
      id="noise"
      step={4}
      title="Noise"
      description="Noise sources added to the ideal clock signal, all expressed as fractional frequency per measurement unless stated."
    >
      {warnings.noise && (
        <p className={styles.groupWarning} role="status">
          {warnings.noise}
        </p>
      )}
      <SpecSlider
        path="noise.measurement_noise"
        value={noise.measurement_noise}
        onChange={(measurement_noise) => {
          set({ measurement_noise })
        }}
        kind="fractional"
        scale="log"
        sliderMin={1e-22}
        error={errors['noise.measurement_noise']}
        hint="Additional white readout and link noise. Enter 0 to disable."
        disabled={disabled}
      />
      <Field id={driftId} label="Frequency drift" readout={formatQuantity(noise.frequency_drift_per_hour, 'per_hour')} error={driftError} hint={driftHint}>
        <NumberInput
          id={driftId}
          value={noise.frequency_drift_per_hour}
          onChange={(frequency_drift_per_hour) => {
            set({ frequency_drift_per_hour })
          }}
          unit="h⁻¹"
          disabled={disabled}
          invalid={Boolean(driftError)}
          describedBy={describedBy(driftId, { error: driftError, hint: driftHint })}
        />
      </Field>
      <SpecSlider
        path="noise.environmental_noise"
        value={noise.environmental_noise}
        onChange={(environmental_noise) => {
          set({ environmental_noise })
        }}
        kind="fractional"
        scale="log"
        sliderMin={1e-22}
        error={errors['noise.environmental_noise']}
        hint="Correlated (30 min) unmodelled potential variations such as tides and atmosphere."
        disabled={disabled}
      />
      <SpecSlider
        path="noise.temperature_fluctuation_k"
        label="Temperature"
        value={noise.temperature_fluctuation_k}
        onChange={(temperature_fluctuation_k) => {
          set({ temperature_fluctuation_k })
        }}
        kind="temperature"
        scale="log"
        sliderMin={1e-5}
        error={errors['noise.temperature_fluctuation_k']}
        hint="RMS temperature fluctuation of the clock environment; converted via the blackbody sensitivity."
        disabled={disabled}
      />
      <SpecSlider
        path="noise.vibration_m"
        value={noise.vibration_m}
        onChange={(vibration_m) => {
          set({ vibration_m })
        }}
        kind="length"
        scale="log"
        sliderMin={1e-7}
        error={errors['noise.vibration_m']}
        hint="RMS vertical height jitter of the clock; converted to potential as g·δz."
        disabled={disabled}
      />
      <SpecSlider
        path="noise.station_height_uncertainty_m"
        value={noise.station_height_uncertainty_m}
        onChange={(station_height_uncertainty_m) => {
          set({ station_height_uncertainty_m })
        }}
        kind="length"
        scale="log"
        sliderMin={1e-4}
        error={errors['noise.station_height_uncertainty_m']}
        hint="How well each station's height is known (about 1 cm from GNSS, about 1 mm from levelling). Enters the normal-field correction as g·δh/c² and does not average down."
        disabled={disabled}
      />
      <SpecSlider
        path="noise.tide_residual_percent"
        value={noise.tide_residual_percent}
        onChange={(tide_residual_percent) => {
          set({ tide_residual_percent })
        }}
        kind="percent"
        step={0.5}
        error={errors['noise.tide_residual_percent']}
        hint={
          config.environment.tides === 'modelled'
            ? 'Ocean and atmospheric loading missing from the tide model, as a percentage of the solid-Earth tide (a few % inland).'
            : 'Used only when Earth tides are modelled (Environment).'
        }
        disabled={disabled}
      />
      <div className={styles.inline}>
        <Field id={seedId} label="Random seed" error={seedError} hint={seedHint}>
          <NumberInput
            id={seedId}
            value={noise.seed}
            onChange={(seed) => {
              set({ seed })
            }}
            disabled={disabled}
            invalid={Boolean(seedError)}
            describedBy={describedBy(seedId, { error: seedError, hint: seedHint })}
          />
        </Field>
        <Button
          icon={<Shuffle />}
          aria-label="Randomize seed"
          disabled={disabled}
          onClick={() => {
            set({ seed: Math.floor(Math.random() * 2 ** 32) })
          }}
        />
      </div>
    </FormSection>
  )
}
