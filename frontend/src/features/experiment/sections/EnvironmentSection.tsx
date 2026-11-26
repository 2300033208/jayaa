import { SegmentedField } from '../../../components/controls/Choice'
import type { EnvironmentConfig } from '../../../types/config'
import { fieldId } from '../fieldId'
import { SpecSlider } from '../SpecSlider'
import { FormSection } from './FormSection'
import type { SectionProps } from './types'

export function EnvironmentSection({ config, edit, errors, warnings, disabled }: SectionProps) {
  const env = config.environment
  const set = (patch: Partial<EnvironmentConfig>) => {
    edit((c) => ({ ...c, environment: { ...c.environment, ...patch } }))
  }
  return (
    <FormSection
      id="environment"
      step={1}
      title="Environment"
      description="Earth model and survey site. The normal gravity field is computed by the engine from these values."
    >
      <SegmentedField
        id={fieldId('environment.earth_model')}
        label="Earth model"
        value={env.earth_model}
        options={[
          { value: 'wgs84', label: 'WGS84 ellipsoid' },
          { value: 'spherical', label: 'Spherical Earth' },
        ]}
        onChange={(earth_model) => {
          set({ earth_model })
        }}
        disabled={disabled}
        hint={env.earth_model === 'wgs84' ? 'Somigliana normal gravity with free-air height terms.' : 'Non-rotating uniform sphere; latitude has no effect.'}
      />
      <SegmentedField
        id={fieldId('environment.terrain')}
        label="Terrain"
        value={env.terrain}
        options={[
          { value: 'flat', label: 'Flat' },
          { value: 'slope', label: 'Slope' },
          { value: 'hills', label: 'Hills' },
        ]}
        onChange={(terrain) => {
          set({ terrain })
        }}
        disabled={disabled}
        hint="Terrain sets the sensor elevation and, with a terrain density, adds the attraction of the hills themselves."
      />
      <SpecSlider
        path="environment.latitude_deg"
        value={env.latitude_deg}
        onChange={(latitude_deg) => {
          set({ latitude_deg })
        }}
        kind="angle"
        step={0.001}
        error={errors['environment.latitude_deg']}
        disabled={disabled}
      />
      <SpecSlider
        path="environment.longitude_deg"
        value={env.longitude_deg}
        onChange={(longitude_deg) => {
          set({ longitude_deg })
        }}
        kind="angle"
        step={0.001}
        error={errors['environment.longitude_deg']}
        hint="Sets the local times of the Sun and Moon for the tides; the normal field is rotationally symmetric."
        disabled={disabled}
      />
      <SpecSlider
        path="environment.elevation_m"
        value={env.elevation_m}
        onChange={(elevation_m) => {
          set({ elevation_m })
        }}
        kind="length"
        step={1}
        error={errors['environment.elevation_m']}
        hint="Height of the survey datum above the reference surface."
        disabled={disabled}
      />
      <SpecSlider
        path="environment.terrain_relief_m"
        value={env.terrain_relief_m}
        onChange={(terrain_relief_m) => {
          set({ terrain_relief_m })
        }}
        kind="length"
        step={1}
        error={errors['environment.terrain_relief_m']}
        warning={warnings['environment.terrain_relief_m']}
        disabled={disabled || env.terrain === 'flat'}
        hint={env.terrain === 'flat' ? 'Not used for flat terrain.' : 'Peak-to-trough ground elevation range.'}
      />
      <SegmentedField
        id={fieldId('environment.tides')}
        label="Earth tides"
        value={env.tides}
        options={[
          { value: 'modelled', label: 'Modelled' },
          { value: 'off', label: 'Off' },
        ]}
        onChange={(tides) => {
          set({ tides })
        }}
        disabled={disabled}
        hint={
          env.tides === 'modelled'
            ? 'Moon and Sun tides at each clock (up to about 3 × 10⁻¹⁷), removed by the analyst with a tide model; the unmodelled residual is set under Noise.'
            : 'No tidal potential (an idealization: real clocks always see the tides).'
        }
      />
      <SpecSlider
        path="environment.terrain_density_kg_m3"
        value={env.terrain_density_kg_m3}
        onChange={(terrain_density_kg_m3) => {
          set({ terrain_density_kg_m3 })
        }}
        kind="density"
        step={10}
        error={errors['environment.terrain_density_kg_m3']}
        hint={env.terrain === 'flat' ? 'Has no effect on flat terrain.' : 'True density of the hills (2670 kg/m³ is the standard crustal value). 0 leaves terrain mass out.'}
        disabled={disabled}
      />
      <SpecSlider
        path="environment.terrain_density_assumed_kg_m3"
        value={env.terrain_density_assumed_kg_m3}
        onChange={(terrain_density_assumed_kg_m3) => {
          set({ terrain_density_assumed_kg_m3 })
        }}
        kind="density"
        step={10}
        error={errors['environment.terrain_density_assumed_kg_m3']}
        hint="Density the analyst uses in the terrain correction. A difference from the true density leaves a systematic residual."
        disabled={disabled}
      />
    </FormSection>
  )
}
