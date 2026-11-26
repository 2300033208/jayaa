import type { LabelStyle } from './Label'
import { Label } from './Label'
import type { SceneFrame } from './sceneMath'

export interface EstimateMarker {
  id: string
  x_m: number
  y_m: number
  depth_m: number
  /** 95 % intervals from the engine's bootstrap (null when unavailable). */
  interval: { x_m: readonly [number, number]; y_m: readonly [number, number]; depth_m: readonly [number, number] } | null
  detected: boolean
}

/** Inverse-reconstruction estimates with their (axis-aligned) 95 % uncertainty region. */
export function Estimates({ estimates, frame, color, labelStyle }: { estimates: readonly EstimateMarker[]; frame: SceneFrame; color: string; labelStyle: LabelStyle }) {
  return (
    <group>
      {estimates.map((e) => {
        const [x, y, z] = frame.toWorld(e.x_m, e.y_m, -e.depth_m)
        const box = e.interval
        // Axis-aligned ellipsoid spanning exactly the engine's 95 % interval on each axis.
        const region = box
          ? {
              center: frame.toWorld((box.x_m[0] + box.x_m[1]) / 2, (box.y_m[0] + box.y_m[1]) / 2, -(box.depth_m[0] + box.depth_m[1]) / 2),
              radii: [
                Math.max(((box.x_m[1] - box.x_m[0]) / 2) * frame.scale, 1e-4),
                Math.max(((box.depth_m[1] - box.depth_m[0]) / 2) * frame.scale, 1e-4),
                Math.max(((box.y_m[1] - box.y_m[0]) / 2) * frame.scale, 1e-4),
              ] as [number, number, number],
            }
          : null
        return (
          <group key={e.id}>
            <group position={[x, y, z]}>
              <mesh renderOrder={4}>
                <sphereGeometry args={[0.1, 24, 16]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
              </mesh>
              <Label position={[0, 0.14, 0]} style={labelStyle} accent={color} text={`Estimate ${e.id}${region ? ' · 95 % region' : ''}`} />
            </group>
            {region && (
              <mesh position={region.center} scale={region.radii} renderOrder={3}>
                <sphereGeometry args={[1, 32, 20]} />
                <meshStandardMaterial color={color} transparent opacity={0.16} depthWrite={false} />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}
