import { SelectField } from '../../components/controls/Choice'
import type { Defaults } from '../../types/api'
import type { ExperimentConfig } from '../../types/config'
import { deepEqual } from '../../utils/misc'
import styles from './experiment.module.css'

interface Props {
  scenarios: Defaults['scenarios']
  config: ExperimentConfig
  onApply: (config: ExperimentConfig) => void
  disabled?: boolean
}

const MODIFIED = 'modified'

/** Starting points for a new experiment, each with the outcome the engine produced for it. */
export function ScenarioPicker({ scenarios, config, onApply, disabled }: Props) {
  const current = scenarios.scenarios.find((s) => deepEqual(s.config, config)) ?? null
  const options = [
    ...scenarios.scenarios.map((s) => ({ value: s.id, label: s.title })),
    ...(current === null ? [{ value: MODIFIED, label: 'Modified configuration', disabled: true }] : []),
  ]
  return (
    <section className={styles.scenario} aria-labelledby="scenario-title">
      <h2 id="scenario-title" className="eyebrow">
        Research scenario
      </h2>
      <SelectField
        id="field-scenario"
        label="Start from"
        value={current?.id ?? MODIFIED}
        options={options}
        disabled={disabled}
        hint={current ? undefined : 'The configuration has been edited; choose a scenario to replace it.'}
        onChange={(id) => {
          const chosen = scenarios.scenarios.find((s) => s.id === id)
          if (chosen) onApply(structuredClone(chosen.config))
        }}
      />
      {current && (
        <div className={styles.scenarioText}>
          <p>{current.summary}</p>
          <p>
            <strong>Expected outcome:</strong> {current.expectation}
          </p>
          <p className={styles.scenarioNote}>{scenarios.note}</p>
        </div>
      )}
    </section>
  )
}
