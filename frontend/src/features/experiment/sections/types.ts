import type { ExperimentConfig } from '../../../types/config'

export interface SectionProps {
  config: ExperimentConfig
  edit: (update: (config: ExperimentConfig) => ExperimentConfig) => void
  errors: Readonly<Record<string, string>>
  warnings: Readonly<Record<string, string>>
  disabled: boolean
}
