import { Check, Compass } from 'lucide-react'
import { useState } from 'react'
import { isAbort } from '../../api/errors'
import { designSurvey } from '../../api/studies'
import { Button } from '../../components/controls/Button'
import { Field } from '../../components/controls/Field'
import { describedBy } from '../../components/controls/fieldA11y'
import { NumberInput } from '../../components/controls/NumberField'
import { ErrorState } from '../../components/feedback/States'
import type { ExperimentConfig } from '../../types/config'
import type { DesignCandidate, DesignResult } from '../../types/studies'
import { formatQuantity } from '../../utils/units'
import type { UserError } from '../../utils/userError'
import { userError } from '../../utils/userError'
import styles from './experiment.module.css'

const SHOWN = 8
const MASS_HINT = "Point source at the first body's position."

interface Props {
  config: ExperimentConfig
  /** The configuration has passed engine validation (the assistant needs a valid base design). */
  ready: boolean
  disabled: boolean
  onApply: (design: DesignCandidate) => void
}

function describe(c: DesignCandidate): string {
  return `${formatQuantity(c.stations, 'count')} stations ${formatQuantity(c.spacing_m, 'length')} apart, ${formatQuantity(c.averaging_time_s, 'duration')} averaging: ${formatQuantity(c.duration_days * 86_400, 'duration')} of fieldwork`
}

function Verdict({ result }: { result: DesignResult }) {
  const best = result.recommended
  const target = `${formatQuantity(result.target.mass_kg, 'mass', { significant: 2 })} at ${formatQuantity(result.target.depth_m, 'length')}`
  if (result.verdict === 'reliable' && best) {
    return (
      <p className={styles.verdict} data-detectable="true">
        <strong>Reliable design found:</strong> {describe(best)} detects {target} in {formatQuantity(best.detection_probability, 'ratio_percent')} of campaigns.
      </p>
    )
  }
  if (result.verdict === 'best_within_budget' && best) {
    return (
      <p className={styles.verdict} data-detectable="false">
        <strong>No design within {formatQuantity(result.max_days * 86_400, 'duration')} detects {target} reliably.</strong> The best achievable is {describe(best)}, detecting it in{' '}
        {formatQuantity(best.detection_probability, 'ratio_percent')} of campaigns. Consider a better clock class, more time, or a larger target.
      </p>
    )
  }
  return (
    <p className={styles.verdict} data-detectable="false">
      <strong>No design fits in {formatQuantity(result.max_days * 86_400, 'duration')}</strong> while resolving {formatQuantity(result.target.depth_m, 'length')} depth. Allow more time.
    </p>
  )
}

/** Searches station spacing and averaging time for a target and a fieldwork budget (engine-computed). */
export function DesignAssistant({ config, ready, disabled, onApply }: Props) {
  const body = config.bodies[0]
  const [mass, setMass] = useState(Math.abs(body?.mass_kg ?? 1e12))
  const [depth, setDepth] = useState(body?.depth_m ?? 1000)
  const [days, setDays] = useState(60)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DesignResult | null>(null)
  const [error, setError] = useState<UserError | null>(null)
  const inputsOk = Number.isFinite(mass) && mass > 0 && Number.isFinite(depth) && depth > 0 && Number.isFinite(days) && days > 0

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await designSurvey(config, { mass_kg: mass, depth_m: depth, max_days: days }))
    } catch (e) {
      if (!isAbort(e)) setError(userError(e, 'Survey design unavailable'))
    } finally {
      setBusy(false)
    }
  }

  const shown = result ? result.candidates.filter((c) => c.within_budget && c.resolves_depth).slice(0, SHOWN) : []
  return (
    <section id="design" className={styles.study} aria-labelledby="design-title" aria-busy={busy}>
      <header className={styles.studyHead}>
        <span className="eyebrow">Plan the campaign</span>
        <h2 id="design-title">Survey design assistant</h2>
        <p>
          Give a target and a fieldwork budget. The engine tries station spacings and averaging times over the configured area and reports the fastest
          design that detects the target in at least 90 % of campaigns.
        </p>
      </header>
      <div className={styles.designInputs}>
        <Field id="field-design-mass" label="Target mass" hint={MASS_HINT}>
          <NumberInput id="field-design-mass" value={mass} onChange={setMass} unit="kg" disabled={disabled || busy} describedBy={describedBy('field-design-mass', { hint: MASS_HINT })} />
        </Field>
        <Field id="field-design-depth" label="Target depth">
          <NumberInput id="field-design-depth" value={depth} onChange={setDepth} unit="m" disabled={disabled || busy} />
        </Field>
        <Field id="field-design-days" label="Fieldwork budget">
          <NumberInput id="field-design-days" value={days} onChange={setDays} unit="d" disabled={disabled || busy} />
        </Field>
        <Button icon={<Compass />} busy={busy} disabled={disabled || busy || !ready || !inputsOk} onClick={() => void run()}>
          Find a design
        </Button>
      </div>
      {!ready && <p className={styles.studyIdle}>Available once the configuration is valid.</p>}
      {error && <ErrorState compact error={error} />}
      {result && (
        <>
          <Verdict result={result} />
          {result.recommended && (
            <Button
              variant="primary"
              icon={<Check />}
              disabled={disabled}
              onClick={() => {
                if (result.recommended) onApply(result.recommended)
              }}
            >
              Apply recommended design
            </Button>
          )}
          {shown.length > 0 && (
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Designs within the budget (scrollable)">
              <table className={styles.table}>
                <caption>Designs within the budget, most likely to detect first.</caption>
                <thead>
                  <tr>
                    <th scope="col">Spacing</th>
                    <th scope="col">Stations</th>
                    <th scope="col">Averaging</th>
                    <th scope="col">Fieldwork</th>
                    <th scope="col">Expected σ</th>
                    <th scope="col">Detected in</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr
                      key={`${c.spacing_m}-${c.averaging_time_s}`}
                      data-recommended={result.recommended?.spacing_m === c.spacing_m && result.recommended.averaging_time_s === c.averaging_time_s}
                    >
                      <td className="mono">{formatQuantity(c.spacing_m, 'length')}</td>
                      <td className="mono">{formatQuantity(c.stations, 'count')}</td>
                      <td className="mono">{formatQuantity(c.averaging_time_s, 'duration')}</td>
                      <td className="mono">{formatQuantity(c.duration_days * 86_400, 'duration')}</td>
                      <td className="mono">{formatQuantity(c.expected_significance_sigma, 'sigma')}</td>
                      <td className="mono">{formatQuantity(c.detection_probability, 'ratio_percent')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.studyIdle}>{result.assumptions}</p>
        </>
      )}
    </section>
  )
}
