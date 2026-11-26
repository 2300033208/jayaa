import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import type { ComponentRef } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import type { ThemeTokens } from '../app/providers/themeContext'
import type { MeasurementBuffer } from '../features/simulation/measurementBuffer'
import type { SurveyPlan } from '../types/api'
import type { EstimateMarker } from './Estimates'
import { Estimates } from './Estimates'
import type { SceneOptions, SceneView } from './sceneOptions'
import { ReferenceClock, Sensor } from './Sensor'
import { Bodies, SliceIndicator, Surface, Volume } from './Subsurface'
import { MeasuredPoints, PlannedPath } from './SurveyPath'
import type { SceneFrame } from './sceneMath'
import { Z_LIMIT, sceneFrame, slicePlane } from './sceneMath'
import styles from './scene.module.css'

export interface EarthSceneProps {
  plan: SurveyPlan
  tokens: ThemeTokens
  options: SceneOptions
  reducedMotion: boolean
  /** Live mode: streamed measurements (buffer + number of rows to show). */
  live?: { buffer: MeasurementBuffer; count: number }
  /** Reconstruction mode: engine estimates. */
  estimates?: readonly EstimateMarker[]
  description: string
}

function CameraRig({ frame, view, resetToken }: { frame: SceneFrame; view: SceneView; resetToken: number }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const get = useThree((state) => state.get)

  useEffect(() => {
    const { camera, invalidate } = get()
    const depth = frame.volumeDepth * frame.scale
    const target = new Vector3(0, view === 'top' ? 0 : -depth * 0.35, 0)
    const distance = 13 + depth * 0.6
    if (view === 'top') camera.position.set(0, distance, 0.001)
    else if (view === 'side') camera.position.set(0, target.y, distance)
    else camera.position.set(distance * 0.55, distance * 0.45, distance * 0.7)
    camera.lookAt(target)
    const c = controls.current
    if (c) {
      c.target.copy(target)
      c.update()
    }
    invalidate()
  }, [frame, view, resetToken, get])

  return <OrbitControls ref={controls} makeDefault enableDamping={false} maxDistance={60} minDistance={2} />
}

/**
 * Three.js view of the survey: ground surface, subsurface volume, configured bodies, survey
 * path, streamed measurement points and the moving sensor (live), or the inverse estimates
 * against the ground truth (reconstruction). Renders on demand only.
 */
export default function EarthScene({ plan, tokens, options, reducedMotion, live, estimates, description }: EarthSceneProps) {
  const frame = useMemo(() => sceneFrame(plan), [plan])
  const clipping = useMemo(() => slicePlane(options.sliceDepth, frame), [options.sliceDepth, frame])
  const latestIndex = live ? Math.min(live.count, live.buffer.length) - 1 : -1
  const latest = live && latestIndex >= 0 ? live.buffer.row(latestIndex) : null
  const lx = latest?.x_m
  const ly = latest?.y_m
  const lz = latest?.z_m
  const sensorTarget = useMemo(
    () => (lx !== undefined && ly !== undefined && lz !== undefined ? frame.toWorld(lx, ly, lz) : null),
    [lx, ly, lz, frame],
  )
  const reference = plan.reference ? frame.toWorld(plan.reference.x_m, plan.reference.y_m, plan.reference.z_m) : null
  const reconstruction = estimates !== undefined
  const neutral = tokens.inkAxis
  const labelStyle = useMemo(
    () => ({ ink: tokens.ink, background: tokens.surface, border: tokens.line, fontFamily: tokens.fontSans }),
    [tokens.ink, tokens.surface, tokens.line, tokens.fontSans],
  )
  const ramp = `linear-gradient(90deg, ${tokens.diverging.join(', ')})`

  return (
    <div className={styles.root}>
      <div className={styles.canvas} role="img" aria-label={description}>
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          camera={{ fov: 40, near: 0.01, far: 400, position: [9, 7, 11] }}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          onCreated={({ gl }) => {
            gl.localClippingEnabled = true
          }}
        >
          <color attach="background" args={[tokens.sceneBg]} />
          <ambientLight intensity={0.9} />
          <directionalLight position={[6, 12, 8]} intensity={1.1} />
          <CameraRig frame={frame} view={options.view} resetToken={options.resetToken} />
          {!options.isolate && <Surface plan={plan} frame={frame} color={tokens.sceneSurface} opacity={0.35} />}
          {!options.isolate && <Volume frame={frame} color={tokens.sceneVolume} />}
          <SliceIndicator depth={options.sliceDepth} frame={frame} color={tokens.accent} />
          {(!reconstruction || options.showTruth) && (
            <Bodies
              bodies={plan.bodies}
              frame={frame}
              denseColor={tokens.sceneDense}
              cavityColor={tokens.sceneCavity}
              opacity={options.opacity}
              clipping={clipping}
              ghost={reconstruction}
              labelStyle={labelStyle}
              labelPrefix={reconstruction ? 'Ground truth' : undefined}
            />
          )}
          {options.showPath && !options.isolate && <PlannedPath plan={plan} frame={frame} color={tokens.scenePath} />}
          {live && options.showPath && (
            <MeasuredPoints
              buffer={live.buffer}
              count={live.count}
              capacity={plan.point_count}
              frame={frame}
              stops={tokens.diverging}
              neutral={neutral}
              size={0.16}
            />
          )}
          {reference && !options.isolate && <ReferenceClock position={reference} color={tokens.ink2} labelStyle={labelStyle} />}
          {live && options.showSensor && (
            <Sensor
              frame={frame}
              target={sensorTarget}
              pulseKey={latestIndex}
              deviation={latest?.z_score ?? null}
              color={tokens.sceneSensor}
              pulseColor={tokens.accent}
              anomalyColor={tokens.warning}
              reducedMotion={reducedMotion}
              labelStyle={labelStyle}
            />
          )}
          {estimates && <Estimates estimates={estimates} frame={frame} color={tokens.sceneEstimate} labelStyle={labelStyle} />}
        </Canvas>
      </div>
      {live && (
        <div className={styles.legend} aria-hidden="true">
          <span>Measurement color: live deviation from baseline</span>
          <span className={styles.legendRamp} style={{ background: ramp }} />
          <span className={styles.legendTicks}>
            <span>−{Z_LIMIT}σ</span>
            <span>0</span>
            <span>+{Z_LIMIT}σ</span>
          </span>
        </div>
      )}
      {reconstruction && (
        <div className={styles.legend} aria-hidden="true">
          <span>● Estimate with 95 % region (engine bootstrap)</span>
          {options.showTruth && <span>◻ Ground truth (configured body, wireframe)</span>}
        </div>
      )}
    </div>
  )
}
