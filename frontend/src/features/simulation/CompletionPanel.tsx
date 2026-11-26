import { ArrowRight, CheckCircle2, CircleDashed } from 'lucide-react'
import { Link } from 'react-router'
import { ProvenanceTag, Quantity } from '../../components/scientific/Quantity'
import type { ResultSummary } from '../../types/api'
import styles from './simulation.module.css'

/** Minimal result reveal after completion. Every value is the engine's inversion output. */
export function CompletionPanel({ summary, analysisHref }: { summary: ResultSummary; analysisHref: string }) {
  const s = summary.primary_source
  const hasDepthCi = s.depth_ci_low !== null && s.depth_ci_high !== null
  return (
    <section className={styles.completion} aria-labelledby="completion-title">
      <div className={styles.completionHead}>
        <span className="eyebrow">Simulation complete · model projection</span>
        <h2 id="completion-title" className={styles.completionTitle}>
          {summary.anomaly_detected ? <CheckCircle2 aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
          {summary.anomaly_detected ? 'Subsurface anomaly detected' : 'No significant anomaly detected'}
        </h2>
        <p className={styles.completionNote}>
          {summary.detection_description}
          {summary.detection_significance_sigma !== null && (
            <>
              {' '}
              (scan significance <Quantity value={summary.detection_significance_sigma} kind="sigma" />)
            </>
          )}
          .{!summary.anomaly_detected && ' The estimates below describe the best-fitting noise pattern, not a located body.'}
        </p>
      </div>
      <dl className={styles.estimates}>
        <div>
          <dt>
            Estimated location <ProvenanceTag kind="estimate" />
          </dt>
          <dd>
            (<Quantity value={s.x_m} kind="length" />, <Quantity value={s.y_m} kind="length" />)
          </dd>
        </div>
        <div>
          <dt>
            Estimated depth <ProvenanceTag kind="estimate" />
          </dt>
          <dd>
            <Quantity value={s.depth_m} kind="length" />
          </dd>
        </div>
        <div>
          <dt>
            Estimated mass <ProvenanceTag kind="estimate" />
          </dt>
          <dd>
            <Quantity value={s.mass_kg} kind="mass" />
          </dd>
        </div>
        <div>
          <dt>
            Depth uncertainty <ProvenanceTag kind="uncertainty" />
          </dt>
          <dd>
            {hasDepthCi ? (
              <>
                <Quantity value={s.depth_ci_low} kind="length" /> – <Quantity value={s.depth_ci_high} kind="length" />
                <span className={styles.ciLabel}> 95 %</span>
              </>
            ) : (
              <Quantity value={null} kind="length" unavailableReason="The bootstrap did not produce enough converged samples for an interval." />
            )}
          </dd>
        </div>
      </dl>
      <Link to={analysisHref} className={styles.analysisLink}>
        Open full analysis
        <ArrowRight aria-hidden="true" />
      </Link>
    </section>
  )
}
