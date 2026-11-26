import { Suspense, lazy, useState } from 'react'
import { useTheme } from '../../app/providers/themeContext'
import { ErrorBoundary } from '../../components/feedback/ErrorBoundary'
import { Skeleton } from '../../components/feedback/States'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import type { EstimateMarker } from '../../three/Estimates'
import { SceneControls } from '../../three/SceneControls'
import type { SceneOptions } from '../../three/sceneOptions'
import { DEFAULT_SCENE_OPTIONS } from '../../three/sceneOptions'
import { isWebGLAvailable, volumeDepthFor } from '../../three/support'
import type { SurveyPlan } from '../../types/api'
import type { UserError } from '../../utils/userError'
import type { MeasurementBuffer } from '../simulation/measurementBuffer'
import styles from './survey.module.css'

const EarthScene = lazy(() => import('../../three/EarthScene'))

function Unavailable({ reason }: { reason: string }) {
  return (
    <div className={styles.fallback} role="note">
      <strong>3D visualization unavailable.</strong>
      <span>{reason}</span>
      <span>Simulation data remains available in 2D below.</span>
    </div>
  )
}

interface SceneViewProps {
  plan: SurveyPlan | null
  planError: UserError | null
  mode: 'live' | 'reconstruction'
  live?: { buffer: MeasurementBuffer; count: number }
  estimates?: readonly EstimateMarker[]
  description: string
  resetKey: string
  className?: string
}

export function SceneView({ plan, planError, mode, live, estimates, description, resetKey, className }: SceneViewProps) {
  const { tokens } = useTheme()
  const reducedMotion = useReducedMotion()
  const [options, setOptions] = useState<SceneOptions>(DEFAULT_SCENE_OPTIONS)
  const [webgl] = useState(isWebGLAvailable)

  let body
  if (!webgl) body = <Unavailable reason="This browser or device does not provide WebGL." />
  else if (plan === null) {
    body = planError ? <Unavailable reason={planError.message} /> : <Skeleton height="100%" label="Loading survey plan" />
  } else {
    body = (
      <ErrorBoundary region="3D visualization" resetKeys={[resetKey]} fallback={<Unavailable reason="The 3D renderer failed." />}>
        <Suspense fallback={<Skeleton height="100%" label="Loading 3D view" />}>
          <EarthScene
            plan={plan}
            tokens={tokens}
            options={options}
            reducedMotion={reducedMotion}
            live={live}
            estimates={estimates}
            description={description}
          />
        </Suspense>
      </ErrorBoundary>
    )
  }

  return (
    <div className={styles.sceneView}>
      <div className={className}>{body}</div>
      {webgl && plan !== null && <SceneControls options={options} onChange={setOptions} maxDepth={volumeDepthFor(plan)} mode={mode} />}
    </div>
  )
}
