import { CrossSection } from '../../components/scientific/CrossSection'
import type { SectionBody } from '../../components/scientific/CrossSection'
import { Quantity, Readout, Readouts } from '../../components/scientific/Quantity'
import type { SurveyPlan } from '../../types/api'
import { useController, useSim } from '../simulation/context'
import styles from './sensor.module.css'

function nearestRow(values: readonly number[], target: number): number {
  let best = 0
  values.forEach((v, i) => {
    if (Math.abs(v - target) < Math.abs((values[best] ?? 0) - target)) best = i
  })
  return best
}

function sectionBodies(plan: SurveyPlan, y: number): SectionBody[] {
  return plan.bodies.map((b, i) => ({
    id: b.id,
    x: b.x_m,
    depth: b.depth_m,
    halfX: b.size_x_m / 2,
    halfZ: b.size_z_m / 2,
    shape: b.geometry === 'sphere' ? 'circle' : 'rect',
    type: b.anomaly_type,
    label: `B${i + 1}`,
    inPlane: Math.abs(b.y_m - y) <= b.size_y_m / 2,
  }))
}

/** Live readouts at the sensor plus a vertical section along the line being surveyed. */
export function SensorPanel() {
  const controller = useController()
  const received = useSim((s) => s.received)
  const plan = useSim((s) => s.plan)
  const status = useSim((s) => s.status)
  const latest = received > 0 ? controller.buffer.row(received - 1) : null
  const lineY = latest?.y_m ?? 0

  // Cheap (≤ 3 bodies, one terrain row); recomputed per render rather than memoized over mutable buffer data.
  const section = (() => {
    if (plan === null) return null
    const j = nearestRow(plan.terrain.y_m, lineY)
    const row = plan.terrain.elevation_m[j] ?? []
    const half = plan.bounds.width_m / 2
    const xs = plan.bodies.flatMap((b) => [b.x_m - b.size_x_m / 2, b.x_m + b.size_x_m / 2])
    return {
      terrain: { x: plan.terrain.x_m, z: row },
      bodies: sectionBodies(plan, lineY),
      xRange: [Math.min(-half, ...xs) * 1.05, Math.max(half, ...xs) * 1.05] as [number, number],
    }
  })()

  const waiting = status === 'idle' ? 'Start the simulation to begin measuring.' : 'Waiting for the first measurement.'

  return (
    <div className={styles.panel}>
      <h2 className="eyebrow">Sensor</h2>
      {section && plan && (
        <CrossSection
          label={latest ? `Sensor at x ${Math.round(latest.x_m)} m above the configured subsurface.` : 'Configured subsurface section.'}
          xRange={section.xRange}
          sensorHeight={plan.sensor_height_m}
          terrain={section.terrain}
          bodies={section.bodies}
          sensor={latest ? { x: latest.x_m, z: latest.z_m } : null}
          sectionNote={`Section along the current survey line (y = ${Math.round(lineY)} m).`}
        />
      )}
      {latest ? (
        <Readouts className={styles.readouts}>
          <Readout label="Position (x, y)">
            <Quantity value={latest.x_m} kind="length" />, <Quantity value={latest.y_m} kind="length" />
          </Readout>
          <Readout label="Sensor elevation" provenance="config">
            <Quantity value={latest.z_m} kind="length" />
          </Readout>
          <Readout label="Δf/f₀ measured" provenance="measurement">
            <Quantity value={latest.raw} kind="fractional" />
          </Readout>
          <Readout label="Potential ΔΦ" provenance="model">
            <Quantity value={latest.potential_m2_s2} kind="potential" />
          </Readout>
          <Readout label="Gravity anomaly Δg" provenance="model">
            <Quantity value={latest.gravity_anomaly_m_s2} kind="gravity_anomaly" />
          </Readout>
          <Readout label="Deviation from baseline" provenance="derived">
            <Quantity value={latest.z_score} kind="sigma" unavailableReason="The engine needs at least five measurements to establish a baseline." />
          </Readout>
        </Readouts>
      ) : (
        <p className={styles.waiting}>{waiting}</p>
      )}
    </div>
  )
}
