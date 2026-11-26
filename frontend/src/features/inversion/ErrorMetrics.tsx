import { Quantity, Readout, Unavailable } from '../../components/scientific/Quantity'
import type { Comparison, InversionDoc } from '../../types/api'
import styles from './inversion.module.css'

interface Props {
  comparison: Comparison
  inversion: InversionDoc
}

/**
 * Error metrics computed by the engine from ground truth and estimates. The page never calls a
 * result "accurate"; it reports the defined metrics and whether truth falls inside the intervals.
 */
export function ErrorMetrics({ comparison, inversion }: Props) {
  const primary = comparison.matches[0]
  const fit = inversion.fit
  return (
    <div className={styles.metricGroup}>
      <h3>Ground truth vs estimate{primary ? ` (${primary.truth_id} ↔ ${primary.source_id})` : ''}</h3>
      <dl className={styles.metrics}>
        <Readout label="Depth error" provenance="derived" large detail="Estimate − truth">
          {primary ? <Quantity value={primary.depth_error_m} kind="length" signed /> : <Unavailable reason="No estimated source was matched to a configured body." />}
        </Readout>
        <Readout label="Mass error" provenance="derived" large detail="Relative to the true mass">
          {primary ? <Quantity value={primary.mass_error_percent} kind="percent" signed /> : <Unavailable reason="No estimated source was matched to a configured body." />}
        </Readout>
        <Readout label="Position error" provenance="derived" large detail="Horizontal distance between centres">
          {primary ? <Quantity value={primary.horizontal_error_m} kind="length" /> : <Unavailable reason="No estimated source was matched to a configured body." />}
        </Readout>
        <Readout label="Field RMSE" provenance="derived" large detail={<>Estimated vs true anomalous Δf/f₀ · <Quantity value={comparison.field_rmse_relative} kind="ratio_percent" unavailableReason="The true anomaly has zero amplitude." /> of amplitude</>}>
          <Quantity value={comparison.field_rmse_fractional} kind="fractional" />
        </Readout>
        <Readout label="Gravity field RMSE" provenance="derived" large detail="Estimated vs true Δg at survey points">
          <Quantity value={comparison.gravity_rmse_m_s2} kind="gravity_anomaly" />
        </Readout>
        <Readout label="Signal-to-noise ratio" provenance="derived" large detail={comparison.snr_definition}>
          <Quantity value={comparison.snr} kind="ratio" significant={3} unavailableReason="No noise was injected, so the ratio is undefined." />
        </Readout>
      </dl>
      <h3>Fit quality (observables only)</h3>
      <dl className={styles.metrics}>
        <Readout label="Residual RMS" provenance="measurement">
          <Quantity value={fit.residual_rms} kind="fractional" />
        </Readout>
        <Readout label="Reduced χ²" detail="Relative to the nominal sensor noise">
          <Quantity value={fit.reduced_chi_square} kind="ratio" unavailableReason="Nominal noise is zero." />
        </Readout>
        <Readout label="Converged">{fit.converged ? 'Yes' : `No — ${fit.message}`}</Readout>
        <Readout label="Data points / parameters">
          <Quantity value={fit.n_points} kind="count" /> / <Quantity value={fit.n_parameters} kind="count" />
        </Readout>
      </dl>
    </div>
  )
}
