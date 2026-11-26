import { createContext, useContext } from 'react'
import { useStore } from '../../utils/store'
import type { SimulationController, SimulationState } from './controller'

export const SimulationContext = createContext<SimulationController | null>(null)

export function useController(): SimulationController {
  const controller = useContext(SimulationContext)
  if (controller === null) throw new Error('useController must be used inside a SimulationContext provider')
  return controller
}

/** Subscribes to one slice of the simulation state; the component re-renders only when it changes. */
export function useSim<S>(selector: (state: SimulationState) => S): S {
  return useStore(useController().store, selector)
}
