import type { Phase } from '../../types/api'

/** Scientific progress messages for each engine phase. */
export const PHASE_MESSAGES: Record<Phase, string> = {
  initializing_earth_model: 'Initializing Earth model…',
  generating_subsurface_field: 'Generating subsurface field…',
  initializing_sensor: 'Initializing sensor…',
  running_survey: 'Running survey…',
  processing_measurements: 'Processing measurements…',
  performing_inversion: 'Performing inversion…',
  calculating_uncertainty: 'Calculating uncertainty…',
  complete: 'Simulation complete.',
}
