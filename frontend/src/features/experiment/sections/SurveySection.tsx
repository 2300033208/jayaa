import { SegmentedField } from '../../../components/controls/Choice'
import { DateField } from '../../../components/controls/DateField'
import { START_DATE_RANGE } from '../limits'
import type { SurveyConfig } from '../../../types/config'
import { formatInteger } from '../../../utils/format'
import { fieldId } from '../fieldId'
import { axisCount } from '../geometry'
import { SpecSlider } from '../SpecSlider'
import { FormSection } from './FormSection'
import type { SectionProps } from './types'

export function SurveySection({ config, edit, errors, warnings, disabled }: SectionProps) {
  const survey = config.survey
  const set = (patch: Partial<SurveyConfig>) => {
    edit((c) => ({ ...c, survey: { ...c.survey, ...patch } }))
  }
  const profile = survey.pattern === 'profile'
  const valid = Number.isFinite(survey.width_m) && Number.isFinite(survey.length_m) && Number.isFinite(survey.spacing_m) && survey.spacing_m > 0
  const nx = valid ? axisCount(survey.width_m, survey.spacing_m) : null
  const ny = valid ? (profile ? 1 : axisCount(survey.length_m, survey.spacing_m)) : null
  const gridHint = nx !== null && ny !== null ? `${formatInteger(nx)} × ${formatInteger(ny)} = ${formatInteger(nx * ny)} measurement points.` : undefined

  return (
    <FormSection id="survey" step={5} title="Survey" description="Where and how densely the sensor samples the field.">
      <SegmentedField
        id={fieldId('survey.pattern')}
        label="Scan pattern"
        value={survey.pattern}
        options={[
          { value: 'serpentine', label: 'Serpentine' },
          { value: 'raster', label: 'Raster' },
          { value: 'profile', label: 'Single profile' },
        ]}
        onChange={(pattern) => {
          set({ pattern })
        }}
        disabled={disabled}
        hint={profile ? 'One line along y = 0; no 2D map is produced.' : 'Grid of parallel lines; enables the 2D anomaly map.'}
      />
      <SpecSlider
        path="survey.sensor_height_m"
        value={survey.sensor_height_m}
        onChange={(sensor_height_m) => {
          set({ sensor_height_m })
        }}
        kind="length"
        scale="log"
        error={errors['survey.sensor_height_m']}
        hint="Height of the clock above the ground."
        disabled={disabled}
      />
      <DateField
        id={fieldId('survey.start_date')}
        label="Campaign start date"
        value={survey.start_date}
        min={START_DATE_RANGE.min}
        max={START_DATE_RANGE.max}
        onChange={(start_date) => {
          set({ start_date })
        }}
        error={errors['survey.start_date']}
        hint="UTC; sets the positions of the Sun and Moon for the tides."
        disabled={disabled}
      />
      <SpecSlider
        path="survey.setup_time_s"
        value={survey.setup_time_s}
        onChange={(setup_time_s) => {
          set({ setup_time_s })
        }}
        kind="duration"
        scale="log"
        sliderMin={60}
        error={errors['survey.setup_time_s']}
        hint="Time to re-establish clock operation after each move (transport time is added separately). Transportable clocks need hours."
        disabled={disabled}
      />
      <SpecSlider
        path="survey.width_m"
        label="Survey area width (x)"
        value={survey.width_m}
        onChange={(width_m) => {
          set({ width_m })
        }}
        kind="length"
        scale="log"
        error={errors['survey.width_m']}
        disabled={disabled}
      />
      <SpecSlider
        path="survey.length_m"
        label="Survey area length (y)"
        value={survey.length_m}
        onChange={(length_m) => {
          set({ length_m })
        }}
        kind="length"
        scale="log"
        error={errors['survey.length_m']}
        disabled={disabled || profile}
        hint={profile ? 'Not used by a single profile.' : undefined}
      />
      <SpecSlider
        path="survey.spacing_m"
        label="Resolution (point spacing)"
        value={survey.spacing_m}
        onChange={(spacing_m) => {
          set({ spacing_m })
        }}
        kind="length"
        scale="log"
        error={errors['survey.spacing_m']}
        warning={warnings['survey.spacing_m']}
        hint={gridHint}
        disabled={disabled}
      />
    </FormSection>
  )
}
