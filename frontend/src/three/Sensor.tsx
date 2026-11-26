import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, Vector3 } from 'three'
import type { LabelStyle } from './Label'
import { Label } from './Label'
import type { SceneFrame } from './sceneMath'

const MOVE_TIME_CONSTANT_S = 0.08
const PULSE_MS = 450
export const ANOMALY_SIGMA = 3

interface SensorProps {
  frame: SceneFrame
  /** Target position in world units (latest measurement). */
  target: readonly [number, number, number] | null
  /** Changes on every new measurement and triggers the pulse. */
  pulseKey: number
  /** Live deviation in σ for the latest measurement (engine value), or null. */
  deviation: number | null
  color: string
  pulseColor: string
  anomalyColor: string
  reducedMotion: boolean
  labelStyle: LabelStyle
}

/**
 * Sensor marker with a vertical sounding line. Moves smoothly toward the newest measurement
 * location and emits a short pulse per measurement; the pulse is larger and uses the anomaly
 * color when the engine's live deviation exceeds 3σ. Rendering is on demand: frames are only
 * requested while something is moving.
 */
export function Sensor({ frame, target, pulseKey, deviation, color, pulseColor, anomalyColor, reducedMotion, labelStyle }: SensorProps) {
  const group = useRef<Group>(null)
  const ring = useRef<Mesh>(null)
  const current = useRef<Vector3 | null>(null)
  const pulseStart = useRef<number | null>(null)
  const invalidate = useThree((state) => state.invalidate)
  const strong = deviation !== null && Math.abs(deviation) >= ANOMALY_SIGMA

  const sounding = useMemo(() => {
    const depth = frame.volumeDepth * frame.scale
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0, -depth - 1, 0]), 3))
    return new Line(geo, new LineBasicMaterial({ color, transparent: true, opacity: 0.5 }))
  }, [frame, color])

  useEffect(() => () => {
    sounding.geometry.dispose()
    sounding.material.dispose()
  }, [sounding])

  useEffect(() => {
    if (target === null) return
    if (current.current === null || reducedMotion) current.current = new Vector3(target[0], target[1], target[2])
    invalidate()
  }, [target, reducedMotion, invalidate])

  useEffect(() => {
    if (reducedMotion || pulseKey < 0) return
    pulseStart.current = performance.now()
    invalidate()
  }, [pulseKey, reducedMotion, invalidate])

  useFrame((_, delta) => {
    let animating = false
    const g = group.current
    if (target !== null && current.current !== null && g !== null) {
      const goal = new Vector3(target[0], target[1], target[2])
      if (current.current.distanceTo(goal) > 1e-4) {
        current.current.lerp(goal, 1 - Math.exp(-delta / MOVE_TIME_CONSTANT_S))
        animating = true
      } else {
        current.current.copy(goal)
      }
      g.position.copy(current.current)
    }
    const r = ring.current
    if (r !== null) {
      const started = pulseStart.current
      if (started === null) {
        r.visible = false
      } else {
        const age = (performance.now() - started) / PULSE_MS
        if (age >= 1) {
          r.visible = false
          pulseStart.current = null
        } else {
          r.visible = true
          r.scale.setScalar(1 + age * (strong ? 4 : 2.2))
          const material = r.material as MeshBasicMaterial
          material.opacity = (strong ? 0.8 : 0.5) * (1 - age)
          material.color.set(strong ? anomalyColor : pulseColor)
          animating = true
        }
      }
    }
    if (animating) invalidate()
  })

  if (target === null) return null
  return (
    <group ref={group} position={[target[0], target[1], target[2]]}>
      <mesh renderOrder={5}>
        <sphereGeometry args={[0.09, 24, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={6}>
        <ringGeometry args={[0.1, 0.13, 40]} />
        <meshBasicMaterial color={pulseColor} transparent opacity={0} depthWrite={false} />
      </mesh>
      <primitive object={sounding} />
      <Label position={[0, 0.16, 0]} style={labelStyle} text="Sensor" bold />
    </group>
  )
}

export function ReferenceClock({ position, color, labelStyle }: { position: readonly [number, number, number]; color: string; labelStyle: LabelStyle }) {
  return (
    <group position={[position[0], position[1], position[2]]}>
      <mesh>
        <boxGeometry args={[0.12, 0.12, 0.12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Label position={[0, -0.34, 0]} style={labelStyle} text="Reference clock" />
    </group>
  )
}
