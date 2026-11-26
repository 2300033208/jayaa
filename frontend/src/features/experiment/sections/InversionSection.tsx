import { SegmentedField } from '../../../components/controls/Choice'
import type { InversionConfig } from '../../../types/config'
import { fieldId } from '../fieldId'
import { SpecSlider } from '../SpecSlider'
import { FormSection } from './FormSection'
import type { SectionProps } from './types'

const COUNT_OPTIONS = [
  { value: '1', label: '1 source' },
  { value: '2', label: '2 sources' },
  { value: '3', label: '3 sources' },
] as const

export function InversionSection({ config, edit, errors, disabled }: SectionProps) {
  const inversion = config.inversion
  const set = (patch: Partial<InversionConfig>) => {
    edit((c) => ({ ...c, inversion: { ...c.inversion, ...patch } }))
  }
  const count = String(inversion.source_count)
  const countValue = COUNT_OPTIONS.find((o) => o.value === count)?.value ?? '1'
  return (
    <FormSection
      id="inversion"
      step={6}
      title="Inversion"
      description="How the engine reconstructs the subsurface from the measurements. The model is chosen by the analyst and never reads the configured bodies."
    >
      <SegmentedField
        id={fieldId('inversion.source_count')}
        label="Sources to fit"
        value={countValue}
        options={COUNT_OPTIONS}
        onChange={(value) => {
          set({ source_count: Number(value) })
        }}
        error={errors['inversion.source_count']}
        hint="Point-mass sources fitted jointly with offset and linear drift."
        disabled={disabled}
      />
      <SpecSlider
        path="inversion.bootstrap_samples"
        value={inversion.bootstrap_samples}
        onChange={(bootstrap_samples) => {
          set({ bootstrap_samples: Math.round(bootstrap_samples) })
        }}
        kind="count"
        step={10}
        error={errors['inversion.bootstrap_samples']}
        hint="Resamples used to compute confidence intervals and parameter distributions."
        disabled={disabled}
      />
    </FormSection>
  )
}
