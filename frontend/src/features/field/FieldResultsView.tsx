import type { Data } from 'plotly.js-dist-min'
import { useMemo, useState } from 'react'
import { useTheme } from '../../app/providers/themeContext'
import { ChartFrame } from '../../components/charts/ChartFrame'
import { axis, baseLayout, divergingScale } from '../../components/charts/chartTheme'
import type { TableModel } from '../../components/charts/DataTable'
import { Segmented } from '../../components/controls/Choice'
import { Banner } from '../../components/feedback/States'
import { Quantity } from '../../components/scientific/Quantity'
import type { Results } from '../../types/api'
import type { FieldResults, FitQuality } from '../../types/field'
import { formatQuantity, lengthScale, maxAbs, scaleFor } from '../../utils/units'
import styles from './field.module.css'

type Layer = 'drift_removed' | 'model' | 'residual' | 'hypothesis'

const LAYERS: { value: Layer; label: string; description: string }[] = [
  { value: 'drift_removed', label: 'Observed', description: 'Measured shift after the normal-field, terrain and tide corrections, with the fitted offset and drift removed' },
  { value: 'model', label: 'Fitted sources', description: 'Signal of the point sources estimated from these data' },
  { value: 'residual', label: 'Residual', description: 'Observed minus the full fitted model; should look like noise' },
  { value: 'hypothesis', label: 'Planned bodies', description: "Signal the experiment's configured bodies would produce at these stations" },
]

const FIT_TEXT: Record<FitQuality, { tone: 'info' | 'warning'; title: string; text: string }> = {
  consistent: { tone: 'info', title: 'Scatter matches the stated uncertainties', text: 'The residuals are consistent with the uncertainty column (reduced χ² between 0.5 and 2).' },
  scatter_exceeds_uncertainties: {
    tone: 'warning',
    title: 'Scatter exceeds the stated uncertainties',
    text: 'The residuals are larger than the uncertainty column allows. Either the uncertainties omit an error (per-station systematics, height errors, unmodelled site effects) or the point-source model does not describe the anomaly. Detection significances are then overstated.',
  },
  uncertainties_overstated: {
    tone: 'warning',
    title: 'Uncertainties look overstated',
    text: 'The residuals are smaller than the uncertainty column implies, so the significance is understated. Check how the uncertainties were derived.',
  },
  unknown: { tone: 'warning', title: 'Fit quality unknown', text: 'The fit statistic could not be computed.' },
}

function StationMap({ results, exportName }: { results: FieldResults; exportName: string }) {
  const { tokens } = useTheme()
  const [layer, setLayer] = useState<Layer>('drift_removed')
  const s = results.stations
  const built = useMemo(() => {
    const values = s[layer]
    const peak = Math.max(maxAbs(s.drift_removed), maxAbs(s.hypothesis), maxAbs(s.model)) || 1
    const zScale = scaleFor('fractional', peak)
    const xy = lengthScale(Math.max(maxAbs(s.x_m), maxAbs(s.y_m)) * 2)
    const bound = peak * zScale.factor
    const unit = zScale.unit ? ` ${zScale.unit}` : ''
    const data: Data[] = [
      {
        type: 'scatter',
        mode: 'markers',
        x: s.x_m.map((v) => v * xy.factor),
        y: s.y_m.map((v) => v * xy.factor),
        text: s.station,
        marker: {
          size: 9,
          color: values.map((v) => v * zScale.factor),
          cmin: -bound,
          cmax: bound,
          cmid: 0,
          colorscale: divergingScale(tokens),
          line: { width: 0.5, color: tokens.lineStrong },
          colorbar: {
            title: { text: `Δf/f${unit}`, side: 'right', font: { size: 11, color: tokens.ink2 } },
            thickness: 10,
            outlinewidth: 0,
            tickfont: { family: tokens.fontMono, size: 10, color: tokens.ink3 },
          },
        },
        hovertemplate: `%{text}<br>East %{x:.4~g} ${xy.unit}<br>North %{y:.4~g} ${xy.unit}<br>%{marker.color:.3g}${unit}<extra></extra>`,
        showlegend: false,
      },
    ]
    const layout = baseLayout(tokens, {
      xaxis: axis(tokens, `East (${xy.unit})`),
      yaxis: axis(tokens, `North (${xy.unit})`, { scaleanchor: 'x', scaleratio: 1 }),
    })
    const table: TableModel = {
      caption: `${LAYERS.find((l) => l.value === layer)?.label ?? ''} at each station`,
      columns: ['Station', 'Time (UTC)', 'East (m)', 'North (m)', 'Value (Δf/f)'],
      rowCount: s.station.length,
      row: (i) => [s.station[i] ?? '', s.time_utc[i] ?? '', (s.x_m[i] ?? 0).toFixed(1), (s.y_m[i] ?? 0).toFixed(1), (values[i] ?? 0).toExponential(3)],
    }
    return { data, layout, table }
  }, [layer, s, tokens])
  const description = LAYERS.find((l) => l.value === layer)?.description ?? ''
  return (
    <ChartFrame
      id="field-map"
      title="Station map"
      subtitle={description}
      controls={
        <Segmented<Layer>
          name="field-map-layer"
          ariaLabel="Map layer"
          value={layer}
          options={LAYERS.map((l) => ({ value: l.value, label: l.label }))}
          onChange={setLayer}
        />
      }
      data={built.data}
      layout={built.layout}
      height={420}
      summary={`Map of ${s.station.length} measured stations coloured by ${description.toLowerCase()}. The colour scale is the same for observed, fitted and planned signals.`}
      table={built.table}
      exportName={`${exportName}-map`}
    />
  )
}

function ObservedVsModel({ results, exportName }: { results: FieldResults; exportName: string }) {
  const { tokens } = useTheme()
  const s = results.stations
  const built = useMemo(() => {
    const peak = Math.max(maxAbs(s.drift_removed), maxAbs(s.model), maxAbs(s.hypothesis)) || 1
    const scale = scaleFor('fractional', peak)
    const f = (v: number) => v * scale.factor
    const unit = scale.unit ? ` (${scale.unit})` : ''
    const bound = peak * scale.factor * 1.05
    const data: Data[] = [
      {
        type: 'scatter',
        mode: 'lines',
        x: [-bound, bound],
        y: [-bound, bound],
        line: { color: tokens.inkAxis, width: 1, dash: 'dot' },
        name: 'Perfect agreement',
        hoverinfo: 'skip',
      },
      {
        type: 'scatter',
        mode: 'markers',
        x: s.hypothesis.map(f),
        y: s.drift_removed.map(f),
        error_y: { type: 'data', array: s.uncertainty.map(f), visible: true, color: tokens.lineStrong, thickness: 1, width: 0 },
        marker: { size: 6, color: tokens.series2, symbol: 'diamond' },
        name: 'Planned bodies',
        text: s.station,
        hovertemplate: `%{text}<br>planned %{x:.3g}<br>observed %{y:.3g}<extra></extra>`,
      },
      {
        type: 'scatter',
        mode: 'markers',
        x: s.model.map(f),
        y: s.drift_removed.map(f),
        marker: { size: 6, color: tokens.series1 },
        name: 'Fitted sources',
        text: s.station,
        hovertemplate: `%{text}<br>fitted %{x:.3g}<br>observed %{y:.3g}<extra></extra>`,
      },
    ]
    const layout = baseLayout(tokens, {
      xaxis: axis(tokens, `Predicted Δf/f${unit}`, { range: [-bound, bound] }),
      yaxis: axis(tokens, `Observed Δf/f${unit}`, { range: [-bound, bound], scaleanchor: 'x', scaleratio: 1 }),
    })
    const table: TableModel = {
      caption: 'Observed shift (offset and drift removed) against the fitted sources and the planned bodies',
      columns: ['Station', 'Observed', '1σ', 'Fitted sources', 'Planned bodies'],
      rowCount: s.station.length,
      row: (i) => [s.station[i] ?? '', ...[s.drift_removed, s.uncertainty, s.model, s.hypothesis].map((series) => (series[i] ?? 0).toExponential(3))],
    }
    return { data, layout, table }
  }, [s, tokens])
  return (
    <ChartFrame
      id="field-agreement"
      title="Observed against predicted"
      subtitle="Each station twice: against the sources fitted to these data, and against the bodies planned in the experiment. Error bars: stated 1σ."
      data={built.data}
      layout={built.layout}
      height={380}
      summary="Scatter of observed against predicted frequency shifts; points on the dotted diagonal agree exactly."
      table={built.table}
      exportName={`${exportName}-agreement`}
    />
  )
}

function SideBySide({ results, simulation, simulationCurrent }: { results: FieldResults; simulation: Results | null; simulationCurrent: boolean }) {
  const f = results.summary
  const p = f.primary_source
  const sim = simulation?.summary ?? null
  const rows: { label: string; field: string; simulated: string }[] = [
    {
      label: 'Detection significance',
      field: formatQuantity(f.detection_significance_sigma, 'sigma'),
      simulated: sim ? formatQuantity(sim.detection_significance_sigma, 'sigma') : '—',
    },
    { label: 'Anomaly detected', field: f.anomaly_detected ? 'Yes' : 'No', simulated: sim ? (sim.anomaly_detected ? 'Yes' : 'No') : '—' },
    { label: 'Estimated mass', field: formatQuantity(p.mass_kg, 'mass', { significant: 3 }), simulated: sim ? formatQuantity(sim.primary_source.mass_kg, 'mass', { significant: 3 }) : '—' },
    { label: 'Estimated depth', field: formatQuantity(p.depth_m, 'length'), simulated: sim ? formatQuantity(sim.primary_source.depth_m, 'length') : '—' },
    {
      label: 'Estimated position (east, north)',
      field: `${formatQuantity(p.x_m, 'length')}, ${formatQuantity(p.y_m, 'length')}`,
      simulated: sim ? `${formatQuantity(sim.primary_source.x_m, 'length')}, ${formatQuantity(sim.primary_source.y_m, 'length')}` : '—',
    },
    { label: 'Measurements', field: String(f.measurement_count), simulated: sim ? String(sim.measurement_count) : '—' },
    {
      label: 'Noise per measurement (1σ)',
      field: formatQuantity(f.median_uncertainty, 'fractional'),
      simulated: simulation ? formatQuantity(simulation.noise_budget.nominal_sigma, 'fractional') : '—',
    },
  ]
  return (
    <section className={styles.block} aria-labelledby="field-compare-title">
      <h3 id="field-compare-title">Field data next to the simulation of the same site</h3>
      {simulation === null ? (
        <p className={styles.note}>No completed simulation of this experiment yet. Run one to compare what was planned with what was measured.</p>
      ) : (
        !simulationCurrent && (
          <p className={styles.note}>The latest simulation used an earlier configuration of this experiment; run it again for a like-for-like comparison.</p>
        )
      )}
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Field data and simulation compared">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Quantity</th>
              <th scope="col">Field data</th>
              <th scope="col">Simulation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.field}</td>
                <td>{r.simulated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function FieldResultsView({
  results,
  simulation,
  simulationCurrent,
  exportName,
}: {
  results: FieldResults
  simulation: Results | null
  simulationCurrent: boolean
  exportName: string
}) {
  const f = results.summary
  const p = f.primary_source
  const fit = FIT_TEXT[f.fit_quality]
  const hyp = results.hypothesis
  const improvement = hyp.chi_square_null - hyp.chi_square_hypothesis
  return (
    <div className={styles.results}>
      <p className={styles.verdict} data-detected={f.anomaly_detected}>
        <strong>{f.anomaly_detected ? 'Anomaly detected' : 'No anomaly detected'}</strong> in {f.measurement_count} measurements at {f.station_count} stations:{' '}
        significance <Quantity value={f.detection_significance_sigma} kind="sigma" /> against the {results.inversion.detection.criterion_sigma}σ criterion,
        after the look-elsewhere correction.
        {f.anomaly_detected && (
          <>
            {' '}
            Strongest source: <Quantity value={p.mass_kg} kind="mass" significant={2} /> at <Quantity value={p.depth_m} kind="length" /> depth
            {p.depth_ci_low !== null && p.depth_ci_high !== null && (
              <>
                {' '}
                (95 % interval <Quantity value={p.depth_ci_low} kind="length" /> to <Quantity value={p.depth_ci_high} kind="length" />)
              </>
            )}
            .
          </>
        )}
      </p>
      <Banner tone={fit.tone} title={fit.title}>
        {fit.text}
        {f.reduced_chi_square !== null && ` Reduced χ² = ${f.reduced_chi_square.toFixed(2)}.`}
      </Banner>
      <dl className={styles.facts}>
        <div>
          <dt>Planned bodies against the data</dt>
          <dd>
            χ² {hyp.chi_square_hypothesis.toFixed(1)} with the {hyp.body_count === 1 ? 'planned body' : `${hyp.body_count} planned bodies`}, {hyp.chi_square_null.toFixed(1)} without (Δχ² ={' '}
            {improvement.toFixed(1)}; {f.measurement_count} measurements)
          </dd>
        </div>
        <div>
          <dt>Corrections applied (RMS over the stations)</dt>
          <dd>
            normal field {formatQuantity(results.corrections.normal_rms, 'fractional')}, terrain {formatQuantity(results.corrections.terrain_rms, 'fractional')} at{' '}
            {formatQuantity(results.corrections.terrain_density_kg_m3, 'density')}, tide {results.corrections.tides === 'modelled' ? formatQuantity(results.corrections.tide_rms, 'fractional') : 'not modelled'}
          </dd>
        </div>
        <div>
          <dt>Reference clock</dt>
          <dd>
            {results.corrections.reference.mode === 'local'
              ? `local, at ${formatQuantity(results.corrections.reference.x_m, 'length')} east, ${formatQuantity(results.corrections.reference.y_m, 'length')} north, ${formatQuantity(results.corrections.reference.height_m, 'length')} height`
              : `remote, ${formatQuantity(results.corrections.reference.distance_km, 'length_km')} north`}
          </dd>
        </div>
        <div>
          <dt>Station spacing (median nearest neighbour)</dt>
          <dd>
            {formatQuantity(f.station_spacing_m, 'length')}; sources shallower than {formatQuantity(results.inversion.fit.min_depth_m, 'length')} are not resolved
          </dd>
        </div>
      </dl>
      <SideBySide results={results} simulation={simulation} simulationCurrent={simulationCurrent} />
      <StationMap results={results} exportName={exportName} />
      <ObservedVsModel results={results} exportName={exportName} />
    </div>
  )
}
