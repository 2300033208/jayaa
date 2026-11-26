import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { CrossSection } from '../../components/scientific/CrossSection'
import type { SectionBody } from '../../components/scientific/CrossSection'
import { Quantity, Readout, Readouts } from '../../components/scientific/Quantity'
import type { ExperimentConfig } from '../../types/config'
import { bodyExtent } from './geometry'
import type { BackendValidation } from './useBackendValidation'
import type { FieldErrors } from './validation'
import styles from './experiment.module.css'

interface Props {
  config: ExperimentConfig
  clientErrors: FieldErrors
  validation: BackendValidation
  onJump: (path: string) => void
}

function sectionBodies(config: ExperimentConfig): SectionBody[] {
  const out: SectionBody[] = []
  config.bodies.forEach((body, i) => {
    const extent = bodyExtent(body)
    if (extent === null || !Number.isFinite(body.depth_m) || !Number.isFinite(body.x_m) || !Number.isFinite(body.y_m)) return
    out.push({
      id: body.id,
      x: body.x_m,
      depth: body.depth_m,
      halfX: extent.halfX,
      halfZ: extent.halfZ,
      shape: body.geometry === 'sphere' ? 'circle' : 'rect',
      type: body.anomaly_type,
      label: `B${i + 1}`,
      inPlane: Math.abs(body.y_m) <= extent.halfY,
    })
  })
  return out
}

function IssueList({ issues, onJump }: { issues: { field: string; message: string }[]; onJump: (path: string) => void }) {
  return (
    <ul className={styles.issues}>
      {issues.slice(0, 8).map((issue) => (
        <li key={`${issue.field}:${issue.message}`}>
          <button
            type="button"
            className={styles.issueLink}
            onClick={() => {
              onJump(issue.field)
            }}
          >
            {issue.message}
          </button>
        </li>
      ))}
      {issues.length > 8 && <li className={styles.more}>and {issues.length - 8} more</li>}
    </ul>
  )
}

export function ConfigPreview({ config, clientErrors, validation, onJump }: Props) {
  const clientIssues = Object.entries(clientErrors).map(([field, message]) => ({ field, message }))
  const result = validation.status === 'done' ? validation.result : validation.status === 'idle' ? null : validation.previous
  const derived = result?.valid ? result.derived : null
  const width = Number.isFinite(config.survey.width_m) ? config.survey.width_m : 1000
  const bodies = sectionBodies(config)
  const xs = bodies.flatMap((b) => [b.x - b.halfX, b.x + b.halfX])
  const xRange: [number, number] = [Math.min(-width / 2, ...xs) * 1.05, Math.max(width / 2, ...xs) * 1.05]

  let status
  if (clientIssues.length > 0) {
    status = (
      <div className={styles.statusBlock} data-tone="critical" role="alert">
        <p className={styles.statusLine}>
          <AlertCircle aria-hidden="true" />
          {clientIssues.length === 1 ? '1 issue to fix' : `${clientIssues.length} issues to fix`}
        </p>
        <IssueList issues={clientIssues} onJump={onJump} />
      </div>
    )
  } else if (validation.status === 'pending' || validation.status === 'idle') {
    status = (
      <p className={styles.statusLine} role="status">
        <Loader2 className={styles.spin} aria-hidden="true" />
        Validating with the simulation engine…
      </p>
    )
  } else if (validation.status === 'error') {
    status = (
      <div className={styles.statusBlock} data-tone="warning" role="status">
        <p className={styles.statusLine}>
          <AlertCircle aria-hidden="true" />
          {validation.error.title}
        </p>
        <p className={styles.statusDetail}>{validation.error.message} The configuration has not been checked by the engine.</p>
      </div>
    )
  } else if (!validation.result.valid) {
    status = (
      <div className={styles.statusBlock} data-tone="critical" role="alert">
        <p className={styles.statusLine}>
          <AlertCircle aria-hidden="true" />
          Rejected by the engine
        </p>
        <IssueList issues={validation.result.errors} onJump={onJump} />
      </div>
    )
  } else {
    status = (
      <p className={styles.statusLine} data-tone="good" role="status">
        <CheckCircle2 aria-hidden="true" />
        Configuration validated by the engine
      </p>
    )
  }

  const engineWarnings = result?.warnings ?? []

  return (
    <div className={styles.preview}>
      <div className={styles.previewBlock}>
        <h2 className="eyebrow">Validation</h2>
        {status}
        {engineWarnings.length > 0 && clientIssues.length === 0 && (
          <div className={styles.statusBlock} data-tone="warning">
            <IssueList issues={engineWarnings} onJump={onJump} />
          </div>
        )}
      </div>
      <div className={styles.previewBlock}>
        <h2 className="eyebrow">Configured section (y = 0)</h2>
        <CrossSection
          label={`Cross-section of the configured subsurface with ${bodies.length} bodies.`}
          xRange={xRange}
          sensorHeight={Number.isFinite(config.survey.sensor_height_m) ? config.survey.sensor_height_m : 0}
          bodies={bodies}
          sectionNote="Configured bodies (ground truth) projected onto the x–depth plane; faded bodies lie off the y = 0 line."
        />
      </div>
      <div className={styles.previewBlock}>
        <h2 className="eyebrow">Engine forward estimate</h2>
        {derived ? (
          <Readouts className={styles.derivedGrid}>
            <Readout label="Measurement points" provenance="derived">
              <Quantity value={derived.survey.point_count} kind="count" />
            </Readout>
            <Readout label="Survey duration" provenance="derived">
              <Quantity value={derived.survey.duration_s} kind="duration" />
            </Readout>
            <Readout label="Noise per measurement (σ)" provenance="model">
              <Quantity value={derived.noise.nominal_sigma} kind="fractional" />
            </Readout>
            <Readout label="Peak anomalous Δf/f₀" provenance="model">
              <Quantity value={derived.forward_estimate.peak_fractional_shift} kind="fractional" />
            </Readout>
            <Readout label="Peak gravity anomaly" provenance="model">
              <Quantity value={derived.forward_estimate.peak_gravity_anomaly_m_s2} kind="gravity_anomaly" />
            </Readout>
            <Readout label="Per-point signal-to-noise" provenance="model">
              <Quantity
                value={derived.forward_estimate.per_point_snr}
                kind="ratio"
                significant={2}
                unavailableReason="Noise level is zero, so the ratio is undefined."
              />
            </Readout>
          </Readouts>
        ) : (
          <p className={styles.statusDetail}>
            {clientIssues.length > 0 ? 'Fix the configuration to see the engine’s forward estimate.' : 'Waiting for the engine.'}
          </p>
        )}
      </div>
    </div>
  )
}
