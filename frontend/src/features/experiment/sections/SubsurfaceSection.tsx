import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../../../components/controls/Button'
import { SegmentedField } from '../../../components/controls/Choice'
import type { BodyConfig, ExperimentConfig } from '../../../types/config'
import { formatQuantity } from '../../../utils/units'
import { fieldId } from '../fieldId'
import { bodyExtent } from '../geometry'
import { BODY_LIMITS } from '../limits'
import { SpecSlider } from '../SpecSlider'
import { FormSection } from './FormSection'
import type { SectionProps } from './types'
import styles from './form.module.css'

function nextBodyId(bodies: readonly BodyConfig[]): string {
  const numbers = bodies.map((b) => Number(/(\d+)$/.exec(b.id)?.[1] ?? 0))
  return `body-${Math.max(0, ...numbers) + 1}`
}

function newBody(config: ExperimentConfig): BodyConfig {
  const offset = config.survey.width_m / 4
  const index = config.bodies.length
  return {
    id: nextBodyId(config.bodies),
    anomaly_type: 'dense',
    geometry: 'sphere',
    density_contrast_kg_m3: 1500,
    mass_kg: 1e12,
    depth_m: 1200,
    x_m: index % 2 === 1 ? -offset : offset,
    y_m: index % 2 === 1 ? offset : -offset,
  }
}

function BodyEditor({ index, body, config, edit, errors, warnings, disabled }: SectionProps & { index: number; body: BodyConfig }) {
  const prefix = `bodies.${index}`
  const set = (patch: Partial<BodyConfig>) => {
    edit((c) => ({ ...c, bodies: c.bodies.map((b, i) => (i === index ? { ...b, ...patch } : b)) }))
  }
  const extent = bodyExtent(body)
  const dense = body.anomaly_type === 'dense'
  const horizontalRange = Math.max(config.survey.width_m, config.survey.length_m) * 0.75
  const canRemove = config.bodies.length > BODY_LIMITS.min_count
  const bodyError = errors[prefix]
  const bodyWarning = warnings[prefix]

  return (
    <div className={styles.bodyCard} role="group" aria-labelledby={`${fieldId(prefix)}-title`} id={fieldId(prefix)}>
      <div className={styles.bodyHeader}>
        <span id={`${fieldId(prefix)}-title`} className={styles.bodyTitle}>
          Body {index + 1}
        </span>
        {canRemove && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 />}
            disabled={disabled}
            onClick={() => {
              edit((c) => ({ ...c, bodies: c.bodies.filter((_, i) => i !== index) }))
            }}
            aria-label={`Remove body ${index + 1}`}
          >
            Remove
          </Button>
        )}
      </div>
      {(bodyError ?? bodyWarning) && (
        <p className={bodyError ? styles.groupError : styles.groupWarning} role={bodyError ? 'alert' : 'status'}>
          {bodyError ?? bodyWarning}
        </p>
      )}
      <SegmentedField
        id={fieldId(`${prefix}.anomaly_type`)}
        label="Anomaly type"
        value={body.anomaly_type}
        options={[
          { value: 'dense', label: 'Dense body' },
          { value: 'cavity', label: 'Cavity' },
        ]}
        onChange={(anomaly_type) => {
          set({ anomaly_type })
        }}
        disabled={disabled}
        hint={dense ? 'Excess mass (e.g. ore body).' : 'Mass deficit (e.g. void or low-density zone).'}
      />
      <SegmentedField
        id={fieldId(`${prefix}.geometry`)}
        label="Geometry"
        value={body.geometry}
        options={[
          { value: 'sphere', label: 'Sphere' },
          { value: 'cube', label: 'Cube' },
          { value: 'slab', label: 'Tabular slab' },
        ]}
        onChange={(geometry) => {
          set({ geometry })
        }}
        disabled={disabled}
        hint={body.geometry === 'slab' ? 'Width and length are three times the thickness.' : undefined}
      />
      <SpecSlider
        path={`${prefix}.mass_kg`}
        label={dense ? 'Mass' : 'Mass deficit'}
        value={body.mass_kg}
        onChange={(mass_kg) => {
          set({ mass_kg })
        }}
        kind="mass"
        scale="log"
        error={errors[`${prefix}.mass_kg`]}
        disabled={disabled}
      />
      <SpecSlider
        path={`${prefix}.density_contrast_kg_m3`}
        value={body.density_contrast_kg_m3}
        onChange={(density_contrast_kg_m3) => {
          set({ density_contrast_kg_m3 })
        }}
        kind="density"
        scale="log"
        error={errors[`${prefix}.density_contrast_kg_m3`]}
        hint="Magnitude of the density difference from the host rock."
        disabled={disabled}
      />
      <SpecSlider
        path={`${prefix}.depth_m`}
        label="Depth to centre"
        value={body.depth_m}
        onChange={(depth_m) => {
          set({ depth_m })
        }}
        kind="length"
        scale="log"
        error={errors[`${prefix}.depth_m`]}
        warning={warnings[`${prefix}.depth_m`]}
        disabled={disabled}
      />
      <div />
      <SpecSlider
        path={`${prefix}.x_m`}
        value={body.x_m}
        onChange={(x_m) => {
          set({ x_m })
        }}
        kind="length"
        sliderMin={-horizontalRange}
        sliderMax={horizontalRange}
        step={10}
        error={errors[`${prefix}.x_m`]}
        disabled={disabled}
      />
      <SpecSlider
        path={`${prefix}.y_m`}
        value={body.y_m}
        onChange={(y_m) => {
          set({ y_m })
        }}
        kind="length"
        sliderMin={-horizontalRange}
        sliderMax={horizontalRange}
        step={10}
        error={errors[`${prefix}.y_m`]}
        warning={warnings[`${prefix}.y_m`]}
        disabled={disabled}
      />
      {extent && (
        <p className={styles.derived}>
          {extent.radius !== null ? (
            <span>
              Radius <strong>{formatQuantity(extent.radius, 'length', { significant: 3 })}</strong>
            </span>
          ) : (
            <span>
              Size{' '}
              <strong>
                {formatQuantity(2 * extent.halfX, 'length', { significant: 3 })} × {formatQuantity(2 * extent.halfY, 'length', { significant: 3 })} ×{' '}
                {formatQuantity(2 * extent.halfZ, 'length', { significant: 3 })}
              </strong>
            </span>
          )}
          <span>
            Top at <strong>{formatQuantity(body.depth_m - extent.halfZ, 'length', { significant: 3 })}</strong> depth
          </span>
          <span>Derived from mass ÷ density contrast</span>
        </p>
      )}
    </div>
  )
}

export function SubsurfaceSection(props: SectionProps) {
  const { config, edit, errors, disabled } = props
  const canAdd = config.bodies.length < BODY_LIMITS.max_count
  return (
    <FormSection
      id="subsurface"
      step={2}
      title="Subsurface mass"
      description="The buried bodies that generate the gravitational anomaly. These are the ground truth the inversion tries to recover."
      actions={
        <Button
          size="sm"
          icon={<Plus />}
          disabled={disabled || !canAdd}
          onClick={() => {
            edit((c) => ({ ...c, bodies: [...c.bodies, newBody(c)] }))
          }}
        >
          Add body
        </Button>
      }
    >
      {errors.bodies && (
        <p className={styles.groupError} role="alert">
          {errors.bodies}
        </p>
      )}
      {config.bodies.map((body, index) => (
        <BodyEditor key={body.id} index={index} body={body} {...props} />
      ))}
    </FormSection>
  )
}
