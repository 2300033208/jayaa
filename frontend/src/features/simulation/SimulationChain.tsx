import type { ChainStep } from '../../components/scientific/SignalChain'
import { SignalChain } from '../../components/scientific/SignalChain'
import type { Phase } from '../../types/api'
import { formatQuantity } from '../../utils/units'
import { useController, useSim } from './context'

const PHASE_ORDER: Record<Phase, number> = {
  initializing_earth_model: 0,
  generating_subsurface_field: 1,
  initializing_sensor: 2,
  running_survey: 3,
  processing_measurements: 4,
  performing_inversion: 5,
  calculating_uncertainty: 6,
  complete: 7,
}

/** The physical chain on the Simulation page, lighting up as the engine progresses. */
export function SimulationChain() {
  const controller = useController()
  const received = useSim((s) => s.received)
  const phase = useSim((s) => s.phase)
  const status = useSim((s) => s.status)
  const plan = useSim((s) => s.plan)
  const summary = useSim((s) => s.summary)
  const latest = received > 0 ? controller.buffer.row(received - 1) : null
  const at = phase === null || status === 'idle' ? -1 : PHASE_ORDER[phase]
  const done = status === 'completed'

  const state = (activeAt: number, doneAfter: number): ChainStep['state'] => {
    if (done || at > doneAfter) return 'done'
    if (at >= activeAt) return 'active'
    return 'pending'
  }
  const body = plan?.bodies[0]
  const steps: ChainStep[] = [
    { id: 'mass', label: 'Subsurface mass', value: body ? formatQuantity(Math.abs(body.mass_kg), 'mass', { significant: 2 }) : undefined, state: state(1, 1) },
    { id: 'field', label: 'Gravity field', value: latest ? formatQuantity(latest.gravity_anomaly_m_s2, 'gravity_anomaly') : undefined, state: state(3, 3) },
    { id: 'potential', label: 'Potential', value: latest ? formatQuantity(latest.potential_m2_s2, 'potential') : undefined, state: state(3, 3) },
    { id: 'shift', label: 'Frequency shift', value: latest ? formatQuantity(latest.fractional_shift, 'fractional') : undefined, state: state(3, 3) },
    { id: 'sensor', label: 'Noisy sensor', value: latest ? formatQuantity(latest.raw, 'fractional') : undefined, state: state(2, 3) },
    { id: 'processing', label: 'Processing', state: state(4, 4) },
    { id: 'inversion', label: 'Inversion', state: state(5, 5) },
    {
      id: 'estimate',
      label: 'Estimate',
      value: summary ? `${formatQuantity(summary.primary_source.depth_m, 'length', { significant: 3 })} deep` : undefined,
      state: done ? 'done' : at >= 6 ? 'active' : 'pending',
    },
  ]
  return <SignalChain steps={steps} label="Signal chain from subsurface mass to estimate" />
}
