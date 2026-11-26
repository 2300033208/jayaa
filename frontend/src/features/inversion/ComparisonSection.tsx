import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react'
import type { Data, Shape } from 'plotly.js-dist-min'
import { useMemo } from 'react'
import { useTheme } from '../../app/providers/themeContext'
import { ChartFrame } from '../../components/charts/ChartFrame'
import { axis, baseLayout } from '../../components/charts/chartTheme'
import type { TableModel } from '../../components/charts/DataTable'
import { ProvenanceTag, Quantity } from '../../components/scientific/Quantity'
import type { Comparison, SourceEstimate, TruthBody, UncertaintyDoc } from '../../types/api'
import { formatNumber } from '../../utils/format'
import { axisTitle, lengthScale, maxAbs } from '../../utils/units'
import styles from './inversion.module.css'

function CiFlag({ value }: { value: boolean | null }) {
  if (value === null) {
    return (
      <span className={styles.flag} data-state="none">
        <MinusCircle aria-hidden="true" /> No interval
      </span>
    )
  }
  return (
    <span className={styles.flag} data-state={value ? 'in' : 'out'}>
      {value ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
      {value ? 'Inside' : 'Outside'}
    </span>
  )
}

interface Props {
  comparison: Comparison
  truth: readonly TruthBody[]
  sources: readonly SourceEstimate[]
  uncertainty: UncertaintyDoc
  exportName: string
}

export function ComparisonSection({ comparison, truth, sources, uncertainty, exportName }: Props) {
  const { tokens } = useTheme()

  const chart = useMemo(() => {
    const intervals = (sourceId: string) => uncertainty.sources.find((u) => u.source_id === sourceId)?.parameters ?? null
    const allX = [...truth.map((b) => b.x_m), ...sources.map((s) => s.x_m.estimate)]
    const allDepth = [...truth.map((b) => b.depth_m + b.size_z_m / 2), ...sources.map((s) => s.depth_m.estimate)]
    const hScale = lengthScale(maxAbs(allX) * 2)
    const vScale = lengthScale(maxAbs(allDepth))
    const shapes: Partial<Shape>[] = truth.map((b) => ({
      type: b.geometry === 'sphere' ? 'circle' : 'rect',
      xref: 'x',
      yref: 'y',
      x0: (b.x_m - b.size_x_m / 2) * hScale.factor,
      x1: (b.x_m + b.size_x_m / 2) * hScale.factor,
      y0: -(b.depth_m - b.size_z_m / 2) * vScale.factor,
      y1: -(b.depth_m + b.size_z_m / 2) * vScale.factor,
      line: { color: tokens.truth, width: 1.5 },
      fillcolor: 'rgba(0,0,0,0)',
    }))
    const data: Data[] = [
      {
        type: 'scatter',
        mode: 'markers',
        name: 'Ground truth (configured body)',
        x: truth.map((b) => b.x_m * hScale.factor),
        y: truth.map((b) => -b.depth_m * vScale.factor),
        marker: { symbol: 'diamond-open', size: 12, color: tokens.truth, line: { width: 2, color: tokens.truth } },
        hovertemplate: `Ground truth<br>X %{x:.4~g} ${hScale.unit}<br>Elevation %{y:.4~g} ${vScale.unit}<extra></extra>`,
      },
      {
        type: 'scatter',
        mode: 'markers',
        name: 'Model estimate · 95 % interval',
        x: sources.map((s) => s.x_m.estimate * hScale.factor),
        y: sources.map((s) => -s.depth_m.estimate * vScale.factor),
        error_x: {
          type: 'data',
          symmetric: false,
          array: sources.map((s) => {
            const p = intervals(s.id)?.x_m
            return typeof p?.ci_high === 'number' ? (p.ci_high - s.x_m.estimate) * hScale.factor : 0
          }),
          arrayminus: sources.map((s) => {
            const p = intervals(s.id)?.x_m
            return typeof p?.ci_low === 'number' ? (s.x_m.estimate - p.ci_low) * hScale.factor : 0
          }),
          color: tokens.series2,
          thickness: 1.5,
          width: 4,
        },
        error_y: {
          type: 'data',
          symmetric: false,
          // Elevation axis: deeper is more negative, so the depth interval maps inverted.
          array: sources.map((s) => {
            const p = intervals(s.id)?.depth_m
            return typeof p?.ci_low === 'number' ? (s.depth_m.estimate - p.ci_low) * vScale.factor : 0
          }),
          arrayminus: sources.map((s) => {
            const p = intervals(s.id)?.depth_m
            return typeof p?.ci_high === 'number' ? (p.ci_high - s.depth_m.estimate) * vScale.factor : 0
          }),
          color: tokens.series2,
          thickness: 1.5,
          width: 4,
        },
        marker: { symbol: 'circle', size: 10, color: tokens.series2, line: { width: 2, color: tokens.surface } },
        hovertemplate: `Model estimate<br>X %{x:.4~g} ${hScale.unit}<br>Elevation %{y:.4~g} ${vScale.unit}<extra></extra>`,
      },
    ]
    const layout = baseLayout(tokens, {
      xaxis: axis(tokens, axisTitle('X position (east)', hScale)),
      yaxis: axis(tokens, axisTitle('Elevation (below datum is negative)', vScale), hScale.unit === vScale.unit ? { scaleanchor: 'x', scaleratio: 1 } : {}),
      shapes,
      showlegend: true,
      hovermode: 'closest',
      uirevision: 'comparison',
    })
    const rows = [
      ...truth.map((b) => ['Ground truth', b.id, formatNumber(b.x_m, 5), formatNumber(b.y_m, 5), formatNumber(b.depth_m, 5)]),
      ...sources.map((s) => ['Model estimate', s.id, formatNumber(s.x_m.estimate, 5), formatNumber(s.y_m.estimate, 5), formatNumber(s.depth_m.estimate, 5)]),
    ]
    const table: TableModel = {
      caption: 'Body centres (configured) and estimated source centres, in metres.',
      columns: ['Type', 'ID', 'X (m)', 'Y (m)', 'Depth (m)'],
      rowCount: rows.length,
      row: (i) => rows[i] ?? [],
    }
    return { data, layout, table }
  }, [truth, sources, uncertainty, tokens])

  return (
    <div className={styles.comparison}>
      {comparison.matches.map((m) => {
        const t = truth.find((b) => b.id === m.truth_id)
        const s = sources.find((x) => x.id === m.source_id)
        if (!t || !s) return null
        return (
          <div key={`${m.truth_id}-${m.source_id}`} className={styles.tableWrap}>
            <table className={styles.table}>
              <caption>
                {t.id} ↔ estimate {s.id}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Parameter</th>
                  <th scope="col">
                    Ground truth <ProvenanceTag kind="truth" />
                  </th>
                  <th scope="col">
                    Simulation estimate <ProvenanceTag kind="estimate" />
                  </th>
                  <th scope="col">Error</th>
                  <th scope="col">Truth vs 95 % interval</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Depth</th>
                  <td><Quantity value={t.depth_m} kind="length" /></td>
                  <td><Quantity value={s.depth_m.estimate} kind="length" /></td>
                  <td><Quantity value={m.depth_error_m} kind="length" signed /></td>
                  <td><CiFlag value={m.truth_within_ci.depth_m} /></td>
                </tr>
                <tr>
                  <th scope="row">Mass</th>
                  <td><Quantity value={t.mass_kg} kind="mass" /></td>
                  <td><Quantity value={s.mass_kg.estimate} kind="mass" /></td>
                  <td><Quantity value={m.mass_error_percent} kind="percent" signed /></td>
                  <td><CiFlag value={m.truth_within_ci.mass_kg} /></td>
                </tr>
                <tr>
                  <th scope="row">Position X</th>
                  <td><Quantity value={t.x_m} kind="length" /></td>
                  <td><Quantity value={s.x_m.estimate} kind="length" /></td>
                  <td><Quantity value={m.x_error_m} kind="length" signed /></td>
                  <td><CiFlag value={m.truth_within_ci.x_m} /></td>
                </tr>
                <tr>
                  <th scope="row">Position Y</th>
                  <td><Quantity value={t.y_m} kind="length" /></td>
                  <td><Quantity value={s.y_m.estimate} kind="length" /></td>
                  <td><Quantity value={m.y_error_m} kind="length" signed /></td>
                  <td><CiFlag value={m.truth_within_ci.y_m} /></td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      })}
      {(comparison.unmatched_truth_ids.length > 0 || comparison.unmatched_source_ids.length > 0) && (
        <p className={styles.note}>
          {comparison.unmatched_truth_ids.length > 0 && `Configured bodies without a matching estimate: ${comparison.unmatched_truth_ids.join(', ')}. `}
          {comparison.unmatched_source_ids.length > 0 && `Estimated sources without a matching body: ${comparison.unmatched_source_ids.join(', ')}.`}
        </p>
      )}
      <ChartFrame
        id="comparison-section"
        title="Vertical section: ground truth vs estimate"
        subtitle="Outlines show the configured bodies; error bars are the engine's 95 % intervals."
        data={chart.data}
        layout={chart.layout}
        height={340}
        summary="Configured body centres and estimated source centres in the x–depth plane."
        table={chart.table}
        exportName={`${exportName}-comparison`}
      />
      <p className={styles.note}>Pairs are formed by {comparison.matching}. Errors are estimate minus ground truth.</p>
    </div>
  )
}
