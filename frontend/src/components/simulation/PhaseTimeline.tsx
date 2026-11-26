import type { Phase, Stage } from '../../types/api'
import { STAGES } from '../../types/api'
import type { SimulationStatus } from '../../features/simulation/stateMachine'
import { PHASE_MESSAGES } from './phaseLabels'
import styles from './simulation.module.css'

const STAGE_LABEL: Record<Stage, string> = {
  setup: 'Setup',
  sensor: 'Sensor',
  measurement: 'Measurement',
  analysis: 'Analysis',
  complete: 'Complete',
}

interface Props {
  status: SimulationStatus
  stage: Stage | null
  phase: Phase | null
}

export function PhaseTimeline({ status, stage, phase }: Props) {
  const current = stage === null ? -1 : STAGES.indexOf(stage)
  const stopped = status === 'failed' || status === 'cancelled'
  let message: string
  if (status === 'idle') message = 'Ready. Start the simulation to begin the survey.'
  else if (status === 'validating') message = 'Validating configuration with the engine…'
  else if (status === 'starting') message = 'Starting simulation…'
  else if (status === 'failed') message = `Stopped during: ${phase ? PHASE_MESSAGES[phase].replace('…', '') : 'start-up'}.`
  else if (status === 'cancelled') message = 'Cancelled by the user.'
  else if (status === 'paused') message = 'Paused. Measurements resume from the current position.'
  else message = phase ? PHASE_MESSAGES[phase] : 'Waiting for the engine…'

  return (
    <div className={styles.timeline}>
      <ol className={styles.stages} aria-label="Simulation stages">
        {STAGES.map((s, i) => {
          let state: 'done' | 'active' | 'pending' | 'stopped' = 'pending'
          if (status === 'completed' || i < current) state = 'done'
          else if (i === current) state = stopped ? 'stopped' : 'active'
          return (
            <li key={s} className={styles.stage} data-state={state} aria-current={state === 'active' ? 'step' : undefined}>
              <span className={styles.stageBar} aria-hidden="true" />
              <span>{STAGE_LABEL[s]}</span>
            </li>
          )
        })}
      </ol>
      <p className={styles.phaseMessage} role="status" aria-live="polite">
        {message}
      </p>
    </div>
  )
}
