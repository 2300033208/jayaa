import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, Line, LineBasicMaterial } from 'three'
import type { MeasurementBuffer } from '../features/simulation/measurementBuffer'
import type { SurveyPlan } from '../types/api'
import type { SceneFrame } from './sceneMath'
import { deviationColor } from './sceneMath'

/** Planned survey path (engine plan). */
export function PlannedPath({ plan, frame, color }: { plan: SurveyPlan; frame: SceneFrame; color: string }) {
  const line = useMemo(() => {
    const n = plan.path.x_m.length
    const positions = new Float32Array(n * 3)
    for (let i = 0; i < n; i += 1) {
      const [x, y, z] = frame.toWorld(plan.path.x_m[i] ?? 0, plan.path.y_m[i] ?? 0, plan.path.z_m[i] ?? 0)
      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    return new Line(geo, new LineBasicMaterial({ color, transparent: true, opacity: 0.35 }))
  }, [plan.path, frame, color])

  useEffect(() => () => {
    line.geometry.dispose()
    line.material.dispose()
  }, [line])

  return <primitive object={line} />
}

interface MeasuredPointsProps {
  buffer: MeasurementBuffer
  count: number
  capacity: number
  frame: SceneFrame
  stops: readonly string[]
  neutral: string
  size: number
}

/**
 * Measurement locations as they are acquired, colored by the engine's live deviation (σ).
 * Attributes are preallocated and only the newly received range is uploaded to the GPU.
 */
export function MeasuredPoints({ buffer, count, capacity, frame, stops, neutral, size }: MeasuredPointsProps) {
  const invalidate = useThree((state) => state.invalidate)
  const written = useRef(0)
  const geometry = useMemo(() => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3))
    geo.setAttribute('color', new BufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3))
    geo.setDrawRange(0, 0)
    return geo
  }, [capacity])

  useEffect(() => {
    written.current = 0
    return () => {
      geometry.dispose()
    }
  }, [geometry])

  // Recolor everything when the palette changes (theme switch).
  useEffect(() => {
    written.current = 0
  }, [stops, neutral, frame])

  useEffect(() => {
    const n = Math.min(count, capacity, buffer.length)
    const from = n < written.current ? 0 : written.current
    if (n === from && n === written.current) return
    const position = geometry.getAttribute('position') as BufferAttribute
    const color = geometry.getAttribute('color') as BufferAttribute
    const xs = buffer.column('x_m')
    const ys = buffer.column('y_m')
    const zs = buffer.column('z_m')
    const zScore = buffer.column('z_score')
    const tmp = new Color()
    for (let i = from; i < n; i += 1) {
      const [x, y, z] = frame.toWorld(xs[i] ?? 0, ys[i] ?? 0, zs[i] ?? 0)
      position.setXYZ(i, x, y, z)
      deviationColor(stops, zScore[i] ?? Number.NaN, neutral, tmp)
      color.setXYZ(i, tmp.r, tmp.g, tmp.b)
    }
    if (n > from) {
      position.clearUpdateRanges()
      color.clearUpdateRanges()
      position.addUpdateRange(from * 3, (n - from) * 3)
      color.addUpdateRange(from * 3, (n - from) * 3)
      position.needsUpdate = true
      color.needsUpdate = true
    }
    geometry.setDrawRange(0, n)
    geometry.computeBoundingSphere()
    written.current = n
    invalidate()
  }, [buffer, count, capacity, frame, geometry, stops, neutral, invalidate])

  return (
    <points geometry={geometry} renderOrder={3}>
      <pointsMaterial size={size} sizeAttenuation vertexColors transparent opacity={0.95} depthWrite={false} />
    </points>
  )
}
