import type { Data, Shape } from 'plotly.js-dist-min'
import { useMemo, useState } from 'react'
import { useTheme } from '../../app/providers/themeContext'
import { ChartFrame } from '../../components/charts/ChartFrame'
import { axis, baseLayout } from '../../components/charts/chartTheme'
import type { TableModel } from '../../components/charts/DataTable'
import { Segmented } from '../../components/controls/Choice'
import { Banner } from '../../components/feedback/States'
import { IntervalBar } from '../../components/scientific/IntervalBar'
import { Quantity, Readout, Readouts, Unavailable } from '../../components/scientific/Quantity'
import type { Comparison, TruthBody, UncertaintyDoc, UncertaintyParameter } from '../../types/api'
import { formatInteger, formatNumber } from '../../utils/format'
import type { DisplayScale, QuantityKind } from '../../utils/units'
import { axisTitle, lengthScale, powerScale } from '../../utils/units'
import styles from './uncertainty.module.css'

const PARAMS: { value: UncertaintyParameter; label: string; kind: QuantityKind }[] = [
  { value: 'mass_kg', label: 'Mass', kind: 'mass' },
  { value: 'depth_m', label: 'Depth', kind: 'length' },
  { value: 'x_m', label: 'X', kind: 'length' },
  { value: 'y_m', label: 'Y', kind: 'length' },
]

function scaleFor(param: UncertaintyParameter, magnitude: number): DisplayScale {
  return param === 'mass_kg' ? powerScale(magnitude, 'kg') : lengthScale(magnitude)
}

interface Props {
  uncertainty: UncertaintyDoc
  comparison: Comparison
  truth: readonly TruthBody[]
  exportName: string
}

export function UncertaintySection({ uncertainty, comparison, truth, exportName }: Props) {
  const { tokens } = useTheme()
  const [param, setParam] = useState<UncertaintyParameter>('depth_m')
  const [sourceId, setSourceId] = useState(uncertainty.sources[0]?.source_id ?? '')
  const source = uncertainty.sources.find((s) => s.source_id === sourceId) ?? uncertainty.sources[0]
  const meta = PARAMS.find((p) => p.value === param) ?? PARAMS[0]
  const match = comparison.matches.find((m) => m.source_id === source?.source_id)
  const truthBody = match ? truth.find((b) => b.id === match.truth_id) : undefined
  const truthValue = truthBody ? truthBody[param] : null
  const within = match ? match.truth_within_ci[param] : null
  const p = source?.parameters[param]
  const level = uncertainty.confidence_level

  const chart = useMemo(() => {
    if (!p?.histogram || meta === undefined) return null
    const edges = p.histogram.bin_edges
    const counts = p.histogram.counts
    const magnitude = Math.max(...edges.map(Math.abs), Math.abs(p.estimate))
    const scale = scaleFor(param, magnitude)
    const centers = counts.map((_, i) => (((edges[i] ?? 0) + (edges[i + 1] ?? 0)) / 2) * scale.factor)
    const widths = counts.map((_, i) => ((edges[i + 1] ?? 0) - (edges[i] ?? 0)) * scale.factor)
    const unit = scale.unit ? ` ${scale.unit}` : ''
    const data: Data[] = [
      {
        type: 'bar',
        x: centers,
        y: counts,
        width: widths,
        name: 'Bootstrap samples',
        marker: { color: tokens.series2, opacity: 0.45, line: { color: tokens.surface, width: 1 } },
        hovertemplate: `%{x:.4g}${unit}<br>%{y} samples<extra></extra>`,
        showlegend: false,
      },
    ]
    const vline = (x: number, color: string, width: number): Partial<Shape> => ({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: x,
      x1: x,
      y0: 0,
      y1: 1,
      line: { color, width },
    })
    const shapes: Partial<Shape>[] = []
    const annotations: { x: number; text: string }[] = []
    if (p.ci_low !== null && p.ci_high !== null) {
      shapes.push({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0: p.ci_low * scale.factor,
        x1: p.ci_high * scale.factor,
        y0: 0,
        y1: 1,
        fillcolor: tokens.series2,
        opacity: 0.08,
        line: { width: 0 },
      })
    }
    shapes.push(vline(p.estimate * scale.factor, tokens.series2, 2))
    annotations.push({ x: p.estimate * scale.factor, text: 'Estimate' })
    if (truthValue !== null) {
      shapes.push(vline(truthValue * scale.factor, tokens.truth, 1.5))
      annotations.push({ x: truthValue * scale.factor, text: 'Ground truth' })
    }
    const layout = baseLayout(tokens, {
      xaxis: axis(tokens, axisTitle(meta.label, scale), { showspikes: false }),
      yaxis: axis(tokens, 'Bootstrap samples', { showspikes: false, rangemode: 'tozero' }),
      bargap: 0,
      shapes,
      annotations: annotations.map((a, i) => ({
        x: a.x,
        y: 1,
        xref: 'x',
        yref: 'paper',
        yanchor: 'bottom',
        yshift: i * 14,
        text: a.text,
        showarrow: false,
        font: { size: 11, color: tokens.ink2 },
      })),
      margin: { l: 56, r: 16, t: 36, b: 44 },
      hovermode: 'closest',
      uirevision: `uncertainty-${param}`,
    })
    const table: TableModel = {
      caption: `Bootstrap distribution of ${meta.label.toLowerCase()} (${formatInteger(counts.reduce((a, b) => a + b, 0))} samples).`,
      columns: [axisTitle('Bin start', scale), axisTitle('Bin end', scale), 'Samples'],
      rowCount: counts.length,
      row: (i) => [
        formatNumber((edges[i] ?? Number.NaN) * scale.factor, 5),
        formatNumber((edges[i + 1] ?? Number.NaN) * scale.factor, 5),
        formatInteger(counts[i] ?? Number.NaN),
      ],
    }
    return { data, layout, table }
  }, [p, param, meta, tokens, truthValue])

  if (source === undefined || p === undefined || meta === undefined) {
    return <Banner tone="warning">The engine returned no uncertainty data.</Banner>
  }

  return (
    <div className={styles.layout}>
      <div className={styles.controls}>
        <Segmented<UncertaintyParameter>
          name="uncertainty-parameter"
          ariaLabel="Parameter"
          value={param}
          options={PARAMS.map(({ value, label }) => ({ value, label }))}
          onChange={setParam}
        />
        {uncertainty.sources.length > 1 && (
          <Segmented
            name="uncertainty-source"
            ariaLabel="Estimated source"
            value={source.source_id}
            options={uncertainty.sources.map((s) => ({ value: s.source_id, label: s.source_id }))}
            onChange={setSourceId}
          />
        )}
      </div>

      <div className={styles.grid}>
        <div className={styles.summary}>
          <h3 className={styles.heading}>
            Estimated {meta.label.toLowerCase()} · {Math.round(level * 100)} % interval
          </h3>
          {p.ci_low !== null && p.ci_high !== null ? (
            <IntervalBar label={`Estimated ${meta.label}`} estimate={p.estimate} low={p.ci_low} high={p.ci_high} kind={meta.kind} confidence={level} truth={truthValue} />
          ) : (
            <p className={styles.note}>
              No confidence interval: only {formatInteger(uncertainty.converged_samples)} bootstrap samples converged, fewer than needed for an interval.
            </p>
          )}
          <Readouts className={styles.readouts}>
            <Readout label="Estimate" provenance="estimate">
              <Quantity value={p.estimate} kind={meta.kind} />
            </Readout>
            <Readout label="Bootstrap standard deviation" provenance="uncertainty">
              <Quantity value={p.bootstrap_std} kind={meta.kind} unavailableReason="Too few converged bootstrap samples." />
            </Readout>
            <Readout label="Linearized standard error" provenance="uncertainty">
              <Quantity value={p.std_error} kind={meta.kind} unavailableReason="The fit covariance matrix was singular." />
            </Readout>
            <Readout label="Ground truth" provenance="truth">
              <Quantity value={truthValue} kind={meta.kind} unavailableReason="No configured body was matched to this source." />
            </Readout>
            <Readout label={`Truth inside ${Math.round(level * 100)} % interval`}>
              {within === null ? <Unavailable reason="No interval or no matched body." /> : within ? 'Yes' : 'No'}
            </Readout>
          </Readouts>
        </div>
        {chart ? (
          <ChartFrame
            id="uncertainty-distribution"
            title={`${meta.label} distribution`}
            subtitle="Parameter values from refitting resampled data. The shaded band is the engine's percentile interval."
            data={chart.data}
            layout={chart.layout}
            height={280}
            summary={`Bootstrap distribution of ${meta.label}.`}
            table={chart.table}
            exportName={`${exportName}-${param}`}
          />
        ) : (
          <ChartFrame
            id="uncertainty-distribution"
            title={`${meta.label} distribution`}
            empty={{ title: 'Distribution unavailable.', message: 'The bootstrap produced fewer than 10 converged samples for this parameter.' }}
            data={[]}
            layout={{}}
            summary="Distribution unavailable"
            table={null}
            exportName={exportName}
          />
        )}
      </div>
      <p className={styles.note}>
        Method: {uncertainty.method}; {formatInteger(uncertainty.converged_samples)} of {formatInteger(uncertainty.samples_used)} resamples converged (block length{' '}
        {formatInteger(uncertainty.block_length)}).
        {uncertainty.capped &&
          ` The engine reduced the requested ${formatInteger(uncertainty.requested_samples)} samples to bound runtime for this dataset size.`}
      </p>
    </div>
  )
}
