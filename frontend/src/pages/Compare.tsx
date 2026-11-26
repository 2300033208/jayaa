import type { Data } from 'plotly.js-dist-min'
import { GitCompare } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { listExperiments } from '../api/experiments'
import { useTheme } from '../app/providers/themeContext'
import { ChartFrame } from '../components/charts/ChartFrame'
import { axis, baseLayout } from '../components/charts/chartTheme'
import type { TableModel } from '../components/charts/DataTable'
import { Button } from '../components/controls/Button'
import { ErrorBoundary } from '../components/feedback/ErrorBoundary'
import { EmptyState, ErrorState, Skeleton } from '../components/feedback/States'
import { Page, PageHeader } from '../components/layout/Page'
import { CLOCK_PRESETS, PERFORMANCE_CLASSES_INFO } from '../features/experiment/limits'
import type { ComparedExperiment, Part } from '../features/compare/useComparison'
import { useComparison } from '../features/compare/useComparison'
import { useResource } from '../hooks/useResource'
import { formatQuantity } from '../utils/units'
import styles from '../features/compare/compare.module.css'

/** Three series: a fourth categorical colour fails the palette's colour-vision checks for line charts. */
export const MAX_COMPARED = 3

function parseIds(raw: string | null): string[] {
  const ids = (raw ?? '').split(',').filter((id) => /^[0-9a-f]{32}$/.test(id))
  return [...new Set(ids)].slice(0, MAX_COMPARED)
}

function value<T>(part: Part<T> | null, render: (v: T) => ReactNode, missing = 'Unavailable'): ReactNode {
  if (part === null) return <span className={styles.muted}>{missing}</span>
  if (!part.ok) return <span className={styles.muted} title={part.error.message}>Unavailable: {part.error.message}</span>
  return render(part.value)
}

interface Row {
  label: string
  cells: ReactNode[]
  /** Plain-text cells used to decide whether the row differs between experiments. */
  keys: string[]
}

function settingRows(items: ComparedExperiment[]): Row[] {
  const configs = items.map((i) => i.experiment.config)
  const derived = items.map((i) => (i.validation.ok ? i.validation.value.derived : null))
  const species = (s: string) => CLOCK_PRESETS.find((p) => p.id === s)?.label ?? 'Custom clock'
  const cls = (c: string) => PERFORMANCE_CLASSES_INFO.find((p) => p.id === c)?.label ?? 'Custom performance'
  const rows: [string, (i: number) => string][] = [
    ['Clock', (i) => `${species(configs[i]?.sensor.clock_species ?? '')} · ${cls(configs[i]?.sensor.performance_class ?? '')}`],
    ['Sensor stability σᵧ(1 s)', (i) => formatQuantity(configs[i]?.sensor.stability_1s ?? Number.NaN, 'fractional')],
    ['Systematic per set-up', (i) => formatQuantity(configs[i]?.sensor.systematic_uncertainty ?? Number.NaN, 'fractional')],
    ['Averaging time per station', (i) => formatQuantity(configs[i]?.sensor.measurement_interval_s ?? Number.NaN, 'duration')],
    ['Station height uncertainty', (i) => formatQuantity(configs[i]?.noise.station_height_uncertainty_m ?? Number.NaN, 'length')],
    ['Stations', (i) => (derived[i] ? formatQuantity(derived[i].survey.point_count, 'count') : 'Unavailable')],
    ['Campaign duration', (i) => (derived[i] ? formatQuantity(derived[i].survey.duration_s, 'duration') : 'Unavailable')],
    ['Per-station noise σ', (i) => (derived[i] ? formatQuantity(derived[i].noise.nominal_sigma, 'fractional', { significant: 2 }) : 'Unavailable')],
    ['Earth tides', (i) => (configs[i]?.environment.tides === 'modelled' ? 'Modelled' : 'Off')],
    [
      'First body',
      (i) => {
        const b = configs[i]?.bodies[0]
        return b ? `${b.anomaly_type} ${b.geometry}, ${formatQuantity(b.mass_kg, 'mass', { significant: 2 })} at ${formatQuantity(b.depth_m, 'length')}` : 'None'
      },
    ],
  ]
  return rows.map(([label, cell]) => {
    const keys = items.map((_, i) => cell(i))
    return { label, cells: keys, keys }
  })
}

function resultRows(items: ComparedExperiment[]): Row[] {
  const latest = (item: ComparedExperiment) => item.experiment.latest_simulation
  const outdated = (item: ComparedExperiment) => {
    const l = latest(item)
    return l !== null && l.configuration_hash !== item.experiment.configuration_hash
  }
  const make = (label: string, render: (item: ComparedExperiment) => ReactNode, text: (item: ComparedExperiment) => string): Row => ({
    label,
    cells: items.map(render),
    keys: items.map(text),
  })
  return [
    make(
      'Expected significance (study)',
      (item) => value(item.detectability, (d) => formatQuantity(d.bodies[0]?.expected_significance_sigma ?? Number.NaN, 'sigma')),
      (item) => (item.detectability.ok ? String(item.detectability.value.bodies[0]?.expected_significance_sigma) : '-'),
    ),
    make(
      'Latest run',
      (item) => {
        const l = latest(item)
        if (l === null) return <span className={styles.muted}>No run yet</span>
        return (
          <span>
            {l.status}
            {outdated(item) && <span className={styles.stale}> · out of date</span>}
          </span>
        )
      },
      (item) => latest(item)?.status ?? 'none',
    ),
    make(
      'Detected',
      (item) => value(item.results, (r) => `${r.summary.anomaly_detected ? 'Yes' : 'No'} (${formatQuantity(r.summary.detection_significance_sigma ?? Number.NaN, 'sigma')})`, 'No completed run'),
      (item) => (item.results?.ok ? String(item.results.value.summary.anomaly_detected) : '-'),
    ),
    make(
      'Estimated depth · 95 % interval',
      (item) =>
        value(
          item.results,
          (r) => {
            const s = r.summary.primary_source
            const ci = s.depth_ci_low !== null && s.depth_ci_high !== null ? ` (${formatQuantity(s.depth_ci_low, 'length')}–${formatQuantity(s.depth_ci_high, 'length')})` : ''
            return `${formatQuantity(s.depth_m, 'length')}${ci}`
          },
          'No completed run',
        ),
      (item) => (item.results?.ok ? String(item.results.value.summary.primary_source.depth_m) : '-'),
    ),
    make(
      'Depth error vs ground truth',
      (item) => value(item.results, (r) => formatQuantity(r.comparison.matches[0]?.depth_error_m ?? Number.NaN, 'length'), 'No completed run'),
      (item) => (item.results?.ok ? String(item.results.value.comparison.matches[0]?.depth_error_m) : '-'),
    ),
  ]
}

function ComparisonTable({ items, rows, caption }: { items: ComparedExperiment[]; rows: Row[]; caption: string }) {
  return (
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={`${caption} (scrollable)`}>
      <table className={styles.table}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Quantity</span>
            </th>
            {items.map((item) => (
              <th scope="col" key={item.experiment.id}>
                <Link to={`/experiments/${item.experiment.id}`}>{item.experiment.code}</Link>
                <span className={styles.expName}>{item.experiment.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const differs = new Set(row.keys).size > 1
            return (
              <tr key={row.label} data-differs={differs}>
                <th scope="row">
                  {row.label}
                  {differs && <span className="visually-hidden"> (differs)</span>}
                </th>
                {row.cells.map((cell, i) => (
                  <td key={items[i]?.experiment.id ?? i}>{cell}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function DetectabilityOverlay({ items }: { items: ComparedExperiment[] }) {
  const { tokens } = useTheme()
  const built = useMemo(() => {
    const colors = [tokens.series1, tokens.series2, tokens.series3]
    const data: Data[] = []
    const rows: string[][] = []
    items.forEach((item, i) => {
      if (!item.detectability.ok) return
      const study = item.detectability.value
      const color = colors[i] ?? tokens.ink2
      const points = study.depths_m
        .map((depth, j) => ({ depth, mass: study.min_detectable_mass_kg[j] ?? null }))
        .filter((p): p is { depth: number; mass: number } => p.mass !== null)
      data.push({
        type: 'scatter',
        mode: 'lines+markers',
        name: item.experiment.code,
        x: points.map((p) => p.mass),
        y: points.map((p) => p.depth),
        line: { color, width: 2 },
        marker: { color, size: 8, line: { width: 2, color: tokens.surface } },
        hovertemplate: `${item.experiment.code}: %{x:.2e} kg detectable at %{y:.4~g} m<extra></extra>`,
      })
      for (const p of points) rows.push([item.experiment.code, formatQuantity(p.depth, 'length'), formatQuantity(p.mass, 'mass', { significant: 2 })])
    })
    const layout = baseLayout(tokens, {
      xaxis: axis(tokens, `Minimum detectable mass (kg, log scale; ${items[0]?.detectability.ok ? items[0].detectability.value.threshold_sigma : 3}σ, median)`, {
        type: 'log',
        exponentformat: 'power',
        dtick: 1,
      }),
      yaxis: axis(tokens, 'Depth of centre (m, log scale)', { type: 'log', autorange: 'reversed', dtick: 1 }),
      margin: { l: 64, r: 16, t: 16, b: 52 },
      hovermode: 'closest',
      showlegend: true,
      legend: { orientation: 'h', x: 0, y: -0.2, yanchor: 'top', font: { size: 12, color: tokens.ink2 } },
      uirevision: 'compare-detectability',
    })
    const table: TableModel = {
      caption: 'Minimum detectable mass by depth for each experiment (engine detectability study).',
      columns: ['Experiment', 'Depth', 'Minimum detectable mass'],
      rowCount: rows.length,
      row: (i) => rows[i] ?? [],
    }
    return { data, layout, table }
  }, [items, tokens])
  return (
    <ChartFrame
      id="compare-detectability"
      title="What each campaign can detect"
      subtitle="Smallest buried mass detected in at least half of campaigns, by depth. Left of a curve is undetectable for that campaign."
      data={built.data}
      layout={built.layout}
      height={360}
      summary="Minimum detectable mass against depth for each compared experiment."
      table={built.table}
      exportName="comparison-detectability"
    />
  )
}

function Selector({ selected, onCompare }: { selected: string[]; onCompare: (ids: string[]) => void }) {
  const experiments = useResource('compare-list', (signal) => listExperiments(200, signal), 'Experiment history unavailable')
  const [chosen, setChosen] = useState<string[]>(selected)
  if (experiments.status === 'error') return <ErrorState compact error={experiments.error} actions={<Button onClick={experiments.reload}>Retry</Button>} />
  if (experiments.status !== 'ready') return <Skeleton height={120} label="Loading experiments" />
  if (experiments.data.length < 2) {
    return (
      <EmptyState
        icon={<GitCompare />}
        title="Two experiments are needed to compare."
        message="Create another experiment, for example from a different research scenario."
        actions={
          <Link className={styles.link} to="/experiments/new">
            New experiment
          </Link>
        }
      />
    )
  }
  return (
    <fieldset className={styles.selector}>
      <legend>Experiments to compare (up to {MAX_COMPARED})</legend>
      <div className={styles.choices}>
        {experiments.data.map((e) => {
          const on = chosen.includes(e.id)
          return (
            <label key={e.id} className={styles.choice}>
              <input
                type="checkbox"
                checked={on}
                disabled={!on && chosen.length >= MAX_COMPARED}
                onChange={() => {
                  setChosen((c) => (on ? c.filter((id) => id !== e.id) : [...c, e.id]))
                }}
              />
              <span className="mono">{e.code}</span> {e.name}
            </label>
          )
        })}
      </div>
      <Button
        variant="primary"
        icon={<GitCompare />}
        disabled={chosen.length < 2}
        onClick={() => {
          onCompare(chosen)
        }}
      >
        Compare {chosen.length > 0 ? `(${chosen.length})` : ''}
      </Button>
    </fieldset>
  )
}

export default function ComparePage() {
  const [params, setParams] = useSearchParams()
  const ids = parseIds(params.get('ids'))
  const comparison = useComparison(ids.length >= 2 ? ids : [])
  return (
    <Page label="Compare experiments">
      <PageHeader title="Compare campaigns" meta="Settings, results and detection limits of two or three experiments side by side. Rows that differ are highlighted." />
      <Selector
        key={ids.join(',')}
        selected={ids}
        onCompare={(next) => {
          setParams({ ids: next.join(',') })
        }}
      />
      {comparison.status === 'error' && <ErrorState error={comparison.error} />}
      {comparison.status === 'loading' && <Skeleton height={360} label="Loading comparison" />}
      {comparison.status === 'ready' && (
        <ErrorBoundary region="Comparison">
          <div className={styles.sections}>
            <ComparisonTable items={comparison.items} rows={settingRows(comparison.items)} caption="Campaign settings (engine-derived values where noted)." />
            <ComparisonTable items={comparison.items} rows={resultRows(comparison.items)} caption="Expected and achieved results." />
            <DetectabilityOverlay items={comparison.items} />
          </div>
        </ErrorBoundary>
      )}
    </Page>
  )
}
