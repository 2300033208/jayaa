import { formatNumber } from '../../utils/format'
import styles from './crossSection.module.css'

export interface SectionBody {
  id: string
  x: number
  depth: number
  halfX: number
  halfZ: number
  shape: 'circle' | 'rect'
  type: 'dense' | 'cavity'
  label: string
  /** False when the body is offset from the section line (drawn faded). */
  inPlane: boolean
}

interface CrossSectionProps {
  label: string
  xRange: readonly [number, number]
  sensorHeight: number
  terrain?: { x: readonly number[]; z: readonly number[] } | null
  bodies: readonly SectionBody[]
  sensor?: { x: number; z: number } | null
  sectionNote?: string
}

const W = 600
const H = 300
const PAD = { left: 56, right: 12, top: 18, bottom: 22 }

function niceStep(span: number, target: number): number {
  const raw = span / target
  const power = 10 ** Math.floor(Math.log10(raw))
  const base = raw / power
  const nice = base < 1.5 ? 1 : base < 3.5 ? 2 : base < 7.5 ? 5 : 10
  return nice * power
}

/**
 * Vertical section (x vs elevation) drawn at true proportions when practical; otherwise the
 * vertical exaggeration is stated explicitly. Geometry only — no physics is computed here.
 */
export function CrossSection({ label, xRange, sensorHeight, terrain, bodies, sensor, sectionNote }: CrossSectionProps) {
  const [x0, x1] = xRange
  const terrainTop = terrain ? Math.max(0, ...terrain.z) : 0
  const top = terrainTop + Math.max(sensorHeight, 0) * 1.5 + (x1 - x0) * 0.02
  const deepest = bodies.reduce((m, b) => Math.max(m, b.depth + b.halfZ), 0)
  const bottom = -Math.max(deepest * 1.15, (x1 - x0) * 0.08)
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const sx = plotW / (x1 - x0)
  const sz = plotH / (top - bottom)
  const exaggeration = sz / sx
  const px = (x: number) => PAD.left + (x - x0) * sx
  const pz = (z: number) => PAD.top + (top - z) * sz
  const step = niceStep(top - bottom, 4)
  const ticks: number[] = []
  for (let v = Math.ceil(bottom / step) * step; v <= top; v += step) ticks.push(v)

  const groundPath = terrain && terrain.x.length > 1
    ? terrain.x.map((x, i) => `${i === 0 ? 'M' : 'L'}${px(x).toFixed(1)},${pz(terrain.z[i] ?? 0).toFixed(1)}`).join(' ')
    : `M${px(x0)},${pz(0)} L${px(x1)},${pz(0)}`
  const groundFill = `${groundPath} L${px(x1)},${pz(bottom)} L${px(x0)},${pz(bottom)} Z`
  const showExaggeration = Math.abs(exaggeration - 1) > 0.05

  return (
    <figure className={styles.figure}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className={styles.svg}>
        <path d={groundFill} className={styles.ground} />
        <path d={groundPath} className={styles.surface} />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left - 4} x2={PAD.left} y1={pz(t)} y2={pz(t)} className={styles.tick} />
            <text x={PAD.left - 8} y={pz(t) + 3.5} className={styles.tickLabel} textAnchor="end">
              {formatNumber(t, 3)}
            </text>
          </g>
        ))}
        <text x={10} y={PAD.top - 6} className={styles.axisLabel}>
          Elevation (m)
        </text>
        {bodies.map((b) => {
          const cls = `${b.type === 'dense' ? styles.dense : styles.cavity} ${b.inPlane ? '' : styles.offPlane}`
          return (
            <g key={b.id}>
              {b.shape === 'circle' && Math.abs(exaggeration - 1) < 0.05 ? (
                <circle cx={px(b.x)} cy={pz(-b.depth)} r={b.halfX * sx} className={cls} />
              ) : b.shape === 'circle' ? (
                <ellipse cx={px(b.x)} cy={pz(-b.depth)} rx={b.halfX * sx} ry={b.halfZ * sz} className={cls} />
              ) : (
                <rect
                  x={px(b.x - b.halfX)}
                  y={pz(-b.depth + b.halfZ)}
                  width={2 * b.halfX * sx}
                  height={2 * b.halfZ * sz}
                  className={cls}
                />
              )}
              <text x={px(b.x)} y={pz(-b.depth) + 4} textAnchor="middle" className={styles.bodyLabel}>
                {b.label}
              </text>
            </g>
          )
        })}
        {sensor && (
          <g>
            <line x1={px(sensor.x)} x2={px(sensor.x)} y1={pz(sensor.z)} y2={pz(bottom)} className={styles.sounding} />
            <circle cx={px(sensor.x)} cy={pz(sensor.z)} r={6} className={styles.sensor} />
            <text x={px(sensor.x) + 10} y={pz(sensor.z) - 6} className={styles.sensorLabel}>
              Sensor
            </text>
          </g>
        )}
      </svg>
      <figcaption className={styles.caption}>
        {sectionNote ?? 'Vertical section through the survey line.'}{' '}
        {showExaggeration ? `Vertical scale ×${formatNumber(exaggeration, 2)} relative to horizontal.` : 'True proportions.'}
      </figcaption>
    </figure>
  )
}
