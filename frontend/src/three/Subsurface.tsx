import { useEffect, useMemo } from 'react'
import type { Plane } from 'three'
import { BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, EdgesGeometry } from 'three'
import type { PlanBody, SurveyPlan } from '../types/api'
import { formatQuantity } from '../utils/units'
import type { LabelStyle } from './Label'
import { Label } from './Label'
import type { SceneFrame } from './sceneMath'

/** Ground surface built from the engine's terrain grid (no client-side terrain model). */
export function Surface({ plan, frame, color, opacity }: { plan: SurveyPlan; frame: SceneFrame; color: string; opacity: number }) {
  const geometry = useMemo(() => {
    const { x_m: xs, y_m: ys, elevation_m: zs } = plan.terrain
    const nx = xs.length
    const ny = ys.length
    const positions = new Float32Array(nx * ny * 3)
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const [wx, wy, wz] = frame.toWorld(xs[i] ?? 0, ys[j] ?? 0, zs[j]?.[i] ?? 0)
        const k = (j * nx + i) * 3
        positions[k] = wx
        positions[k + 1] = wy
        positions[k + 2] = wz
      }
    }
    const indices: number[] = []
    for (let j = 0; j < ny - 1; j += 1) {
      for (let i = 0; i < nx - 1; i += 1) {
        const a = j * nx + i
        const b = a + 1
        const c = a + nx
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }, [plan.terrain, frame])

  useEffect(() => () => {
    geometry.dispose()
  }, [geometry])

  return (
    <mesh geometry={geometry} renderOrder={2}>
      <meshStandardMaterial color={color} transparent opacity={opacity} side={DoubleSide} depthWrite={false} roughness={1} />
    </mesh>
  )
}

/** Outline of the subsurface volume below the survey area. */
export function Volume({ frame, color }: { frame: SceneFrame; color: string }) {
  const { geometry, center } = useMemo(() => {
    const w = frame.halfWidth * 2 * frame.scale
    const l = frame.halfLength * 2 * frame.scale
    const h = frame.volumeDepth * frame.scale
    const box = new BoxGeometry(w, h, l)
    const edges = new EdgesGeometry(box)
    box.dispose()
    return { geometry: edges, center: [0, -h / 2, 0] as const }
  }, [frame])

  useEffect(() => () => {
    geometry.dispose()
  }, [geometry])

  return (
    <lineSegments geometry={geometry} position={center}>
      <lineBasicMaterial color={color} transparent opacity={0.45} />
    </lineSegments>
  )
}

interface BodiesProps {
  bodies: readonly PlanBody[]
  frame: SceneFrame
  denseColor: string
  cavityColor: string
  opacity: number
  clipping: Plane[]
  ghost?: boolean
  labelStyle: LabelStyle | null
  labelPrefix?: string
}

/** Configured (ground-truth) bodies. Cavities are drawn as wireframes so type is not color-only. */
export function Bodies({ bodies, frame, denseColor, cavityColor, opacity, clipping, ghost = false, labelStyle, labelPrefix }: BodiesProps) {
  return (
    <group>
      {bodies.map((body) => {
        const [x, y, z] = frame.toWorld(body.x_m, body.y_m, -body.depth_m)
        const dense = body.anomaly_type === 'dense'
        const color = dense ? denseColor : cavityColor
        const wire = ghost || !dense
        const sx = body.size_x_m * frame.scale
        const sy = body.size_z_m * frame.scale
        const sz = body.size_y_m * frame.scale
        return (
          <group key={body.id} position={[x, y, z]}>
            <mesh renderOrder={1}>
              {body.geometry === 'sphere' ? <sphereGeometry args={[sx / 2, 40, 24]} /> : <boxGeometry args={[sx, sy, sz]} />}
              <meshStandardMaterial
                color={color}
                transparent
                opacity={wire ? Math.min(0.9, opacity + 0.3) : opacity}
                wireframe={wire}
                clippingPlanes={clipping}
                clipShadows
                roughness={0.7}
                depthWrite={!wire && opacity > 0.95}
              />
            </mesh>
            {labelStyle && (
              <Label
                position={[0, sy / 2 + 0.12, 0]}
                style={labelStyle}
                text={`${labelPrefix ? `${labelPrefix} · ` : ''}${dense ? 'Dense body' : 'Cavity'} · ${formatQuantity(Math.abs(body.mass_kg), 'mass', { significant: 2 })}`}
              />
            )}
          </group>
        )
      })}
    </group>
  )
}

export function SliceIndicator({ depth, frame, color }: { depth: number | null; frame: SceneFrame; color: string }) {
  if (depth === null) return null
  const w = frame.halfWidth * 2 * frame.scale
  const l = frame.halfLength * 2 * frame.scale
  return (
    <mesh position={[0, -depth * frame.scale, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w, l]} />
      <meshBasicMaterial color={color} transparent opacity={0.12} side={DoubleSide} depthWrite={false} />
    </mesh>
  )
}
