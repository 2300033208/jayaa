import { CheckCircle2, CircleDashed } from 'lucide-react'
import { Quantity, Readout, Unavailable } from '../../components/scientific/Quantity'
import type { ChainStep } from '../../components/scientific/SignalChain'
import { SignalChain } from '../../components/scientific/SignalChain'
import type { InversionDoc, Results } from '../../types/api'
import { formatQuantity, maxAbs } from '../../utils/units'
import type { MeasurementBuffer } from '../simulation/measurementBuffer'
import styles from './resultSummary.module.css'

/** RESULTS header: detection outcome and the primary model estimate with its intervals. */
export function ResultSummary({ results, inversion }: { results: Results; inversion: InversionDoc | null }) {
  const { summary } = results
  const s = summary.primary_source
  const noInterval = 'The bootstrap did not produce enough converged samples for an interval.'
  const minDepth = inversion?.fit.min_depth_m ?? null
  const atResolutionLimit = minDepth !== null && s.depth_m <= minDepth * 1.001
  return (
    <section className={styles.summary} aria-labelledby="results-title">
      <div className={styles.head}>
        <span className="eyebrow">Results · simulation estimate</span>
        <h2 id="results-title" className={styles.title}>
          {summary.anomaly_detected ? <CheckCircle2 aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
          {summary.anomaly_detected ? 'Anomaly detected' : 'No significant anomaly detected'}
        </h2>
        <p className={styles.note}>
          Detection significance{' '}
          <Quantity value={summary.detection_significance_sigma} kind="sigma" unavailableReason="The detection scan needs a non-zero instrument noise level." />{' '}
          (look-elsewhere corrected). Criterion: {summary.detection_description.toLowerCase()}. Mass constraint{' '}
          <Quantity value={s.mass_significance_sigma} kind="sigma" unavailableReason="No mass uncertainty is available." /> (estimated mass
          divided by its standard deviation).
        </p>
        {!summary.anomaly_detected && (
          <p className={styles.caveat} role="note">
            No buried mass was detected, so the estimates below describe the best-fitting noise pattern, not a located body.
          </p>
        )}
        {summary.anomaly_detected && atResolutionLimit && (
          <p className={styles.caveat} role="note">
            The estimated depth sits at the survey&apos;s resolution limit (<Quantity value={minDepth} kind="length" />, half the station
            spacing): the source may be shallower than the stations can resolve.
          </p>
        )}
      </div>
      <dl className={styles.values}>
        <Readout label="Estimated depth" provenance="estimate" large>
          <Quantity value={s.depth_m} kind="length" />
        </Readout>
        <Readout label="Estimated mass" provenance="estimate" large>
          <Quantity value={s.mass_kg} kind="mass" />
        </Readout>
        <Readout label="Estimated position (x, y)" provenance="estimate" large>
          <Quantity value={s.x_m} kind="length" />, <Quantity value={s.y_m} kind="length" />
        </Readout>
        <Readout label="Depth · 95 % interval" provenance="uncertainty" large>
          {s.depth_ci_low !== null && s.depth_ci_high !== null ? (
            <>
              <Quantity value={s.depth_ci_low} kind="length" /> – <Quantity value={s.depth_ci_high} kind="length" />
            </>
          ) : (
            <Unavailable reason={noInterval} />
          )}
        </Readout>
        <Readout label="Mass · 95 % interval" provenance="uncertainty" large>
          {s.mass_ci_low !== null && s.mass_ci_high !== null ? (
            <>
              <Quantity value={s.mass_ci_low} kind="mass" significant={2} /> – <Quantity value={s.mass_ci_high} kind="mass" significant={2} />
            </>
          ) : (
            <Unavailable reason={noInterval} />
          )}
        </Readout>
      </dl>
    </section>
  )
}

interface ChainProps {
  results: Results
  inversion: InversionDoc | null
  buffer: MeasurementBuffer | null
}

/** Mass → field → potential → frequency shift → noisy sensor → processing → anomaly → inversion → estimate. */
export function AnalysisChain({ results, inversion, buffer }: ChainProps) {
  const truth = results.ground_truth.bodies[0]
  const peakDg = buffer ? maxAbs(buffer.column('gravity_anomaly_m_s2')) : null
  const peakPhi = buffer ? maxAbs(buffer.column('potential_m2_s2')) : null
  const s = results.summary.primary_source
  const steps: ChainStep[] = [
    { id: 'mass', label: 'Subsurface mass', value: truth ? formatQuantity(Math.abs(truth.mass_kg), 'mass', { significant: 2 }) : undefined, href: '#reconstruction', state: 'done' },
    { id: 'field', label: 'Gravity field', value: peakDg !== null ? `peak ${formatQuantity(peakDg, 'gravity_anomaly')}` : undefined, href: '#anomaly-map-section', state: 'done' },
    { id: 'potential', label: 'Potential', value: peakPhi !== null ? `peak ${formatQuantity(peakPhi, 'potential')}` : undefined, href: '#frequency', state: 'done' },
    { id: 'shift', label: 'Frequency shift', value: formatQuantity(results.comparison.signal_amplitude_fractional, 'fractional'), href: '#frequency', state: 'done' },
    { id: 'sensor', label: 'Noisy sensor', value: `σ ${formatQuantity(results.noise_budget.nominal_sigma, 'fractional', { significant: 2 })}`, href: '#signal-noise', state: 'done' },
    { id: 'processing', label: 'Processing', value: 'drift fitted', href: '#frequency', state: 'done' },
    {
      id: 'anomaly',
      label: 'Anomaly',
      value: results.summary.detection_significance_sigma !== null ? formatQuantity(results.summary.detection_significance_sigma, 'sigma') : undefined,
      href: '#anomaly-map-section',
      state: 'done',
    },
    {
      id: 'inversion',
      label: 'Inversion',
      value: typeof inversion?.fit.reduced_chi_square === 'number' ? `χ²ᵥ ${formatQuantity(inversion.fit.reduced_chi_square, 'ratio')}` : undefined,
      href: '#comparison',
      state: 'done',
    },
    { id: 'estimate', label: 'Estimate', value: `${formatQuantity(s.depth_m, 'length', { significant: 3 })} deep`, href: '#uncertainty', state: 'done' },
  ]
  return <SignalChain steps={steps} label="From subsurface mass to estimate" />
}
