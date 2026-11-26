import { createContext, useContext, useEffect } from 'react'
import { isExperimentId, readStored, writeStored } from '../../utils/storage'

export interface ActiveExperiment {
  id: string
  code: string
  name: string
}

export interface ShellContextValue {
  active: ActiveExperiment | null
  setActive: (experiment: ActiveExperiment | null) => void
}

export const ShellContext = createContext<ShellContextValue | null>(null)

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext)
  if (value === null) throw new Error('useShell must be used inside the application shell')
  return value
}

const LAST_KEY = 'last-experiment'
const LAST_MAX_AGE_MS = 30 * 24 * 3600 * 1000

export function lastExperimentId(): string | null {
  return readStored(LAST_KEY, isExperimentId, LAST_MAX_AGE_MS)
}

export function rememberExperimentId(id: string): void {
  writeStored(LAST_KEY, id)
}

/** Pages call this once their experiment has loaded, so the shell can show its code and links. */
export function usePublishExperiment(experiment: ActiveExperiment | null): void {
  const { setActive } = useShell()
  const id = experiment?.id ?? null
  const code = experiment?.code ?? null
  const name = experiment?.name ?? null
  useEffect(() => {
    if (id === null || code === null || name === null) return
    setActive({ id, code, name })
    rememberExperimentId(id)
  }, [id, code, name, setActive])
}
