import type { Data } from 'plotly.js-dist-min'
import { useMemo } from 'react'
import { useTheme } from '../../app/providers/themeContext'
import { ChartFrame } from '../../components/charts/ChartFrame'
import { axis, baseLayout } from '../../components/charts/chartTheme'
import type { TableModel } from '../../components/charts/DataTable'
import { Segmented } from '../../components/controls/Choice'
import { ErrorState, Skeleton } from '../../components/feedback/States'
import { Quantity } from '../../components/scientific/Quantity'
import type { CaseSummary, GravimeterKind, InstrumentCase, InstrumentComparison } from '../../types/research'
import { INSTRUMENT_CASES } from '../../types/research'
import { formatQuantity } from '../../utils/units'
import type { InstrumentState } from './useInstrumentComparison'
import styles from '../experiment/experiment.module.css'

const CASE_LABELS: Record<InstrumentCase, string> = { clock: 'Clock only', gravimeter: 'Gravimeter only', joint: 'Clock + gravimeter' }
const GRAVIMETER_OPTIONS = [
  { value: 'relative', label: 'Relative gravimeter' },
  { value: 'absolute', label: 'Absolute gravimeter' },
] as const

function Verdict({ c }: { c: InstrumentComparison }) {
  const clock = c.cases.clock.snr
  const gravity = c.cases.gravimeter.snr
  const gain = c.depth_gain
  const adds = gain !== null && gain <= c.clock_sweep.depth_gain_threshold
  return (
    <p className={styles.verdict} data-detectable={adds}>
      <strong>{adds ? 'The clock adds depth information' : 'The gravimeter dominates'}:</strong> on the same {c.station_count} stations the clock
      reaches an expected SNR of <Quantity value={clock} kind="ratio" /> and the {c.gravimeter.label.toLowerCase()} (
      <Quantity value={c.gravimeter.sigma_m_s2} kind="gravity_anomaly" /> per station) <Quantity value={gravity} kind="ratio" />.{' '}
      {gain !== null && (
        <>
          Adding the clock changes the depth uncertainty by a factor of <Quantity value={gain} kind="ratio" significant={4} />.{' '}
        </>
      )}
      {c.clock_sweep.equal_snr_clock_sigma !== null && (
        <>
          The clock would match the gravimeter at <Quantity value={c.clock_sweep.equal_snr_clock_sigma} kind="fractional" significant={2} /> per
          station (now <Quantity value={c.clock.sigma} kind="fractional" significant={2} />)
        </>
      )}
      {c.clock_sweep.depth_gain_clock_sigma !== null && (
        <>
          , and would improve the joint depth estimate by {Math.round((1 - c.clock_sweep.depth_gain_threshold) * 100)} % at{' '}
          <Quantity value={c.clock_sweep.depth_gain_clock_sigma} kind="fractional" significant={2} />
        </>
      )}
      .
    </p>
  )
}

function caseCells(s: CaseSummary, mass: number, depth: number): string[] {
  const mc = s.monte_carlo
  return [
    formatQuantity(s.snr, 'ratio'),
    s.std.mass_kg === null ? 'Not identifiable' : `± ${formatQuantity(s.std.mass_kg, 'mass', { significant: 2 })} (${formatQuantity(s.std.mass_kg / Math.abs(mass), 'ratio_percent')})`,
    s.std.depth_m === null ? 'Not identifiable' : `± ${formatQuantity(s.std.depth_m, 'length', { significant: 3 })} (${formatQuantity(s.std.depth_m / depth, 'ratio_percent')})`,
    formatQuantity(s.mass_depth_correlation, 'ratio', { significant: 3 }),
    mc.realizations === 0 ? '—' : `± ${formatQuantity(mc.depth_std_m, 'length', { significant: 3 })} (${String(mc.converged)}/${String(mc.realizations)})`,
  ]
}

function CaseTable({ c }: { c: InstrumentComparison }) {
  return (
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Clock, gravimeter and joint uncertainties (scrollable)">
      <table className={styles.table}>
        <caption>
          Expected SNR at the true position and Cramér–Rao bounds (1σ) for the first body as a point source; the last column is the scatter of
          nonlinear Monte Carlo fits (converged / run).
        </caption>
        <thead>
          <tr>
            <th scope="col">Survey</th>
            <th scope="col">Expected SNR</th>
            <th scope="col">Mass</th>
            <th scope="col">Depth</th>
            <th scope="col">Mass–depth correlation</th>
            <th scope="col">Monte Carlo depth</th>
          </tr>
        </thead>
        <tbody>
          {INSTRUMENT_CASES.map((name) => (
            <tr key={name}>
              <th scope="row">{CASE_LABELS[name]}</th>
              {caseCells(c.cases[name], c.source.mass_kg, c.source.depth_m).map((cell, i) => (
                <td key={i} className="mono">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ClockSweepChart({ c }: { c: InstrumentComparison }) {
  const { tokens } = useTheme()
  const built = useMemo(() => {
    const s = c.clock_sweep
    const x = s.clock_sigma
    const vertical = (value: number, name: string, color: string, dash: 'dash' | 'dot'): Data => ({
      type: 'scatter',
      mode: 'lines',
      name,
      x: [value, value],
      y: [Math.min(...nonNull([...s.joint_depth_std_m, ...s.clock_depth_std_m])), Math.max(...nonNull(s.clock_depth_std_m))],
      line: { color, width: 1.5, dash },
      hovertemplate: `${name}: %{x:.2e}<extra></extra>`,
    })
    const data: Data[] = [
      {
        type: 'scatter',
        mode: 'lines',
        name: 'Clock only',
        x,
        y: s.clock_depth_std_m,
        line: { color: tokens.series1, width: 2 },
        hovertemplate: 'Clock σ %{x:.2e}<br>Depth ± %{y:.4~g} m<extra>Clock only</extra>',
      },
      {
        type: 'scatter',
        mode: 'lines',
        name: 'Clock + gravimeter',
        x,
        y: s.joint_depth_std_m,
        line: { color: tokens.series3, width: 2.5 },
        hovertemplate: 'Clock σ %{x:.2e}<br>Depth ± %{y:.4~g} m<extra>Joint</extra>',
      },
      {
        type: 'scatter',
        mode: 'lines',
        name: 'Gravimeter only',
        x: [x[0] ?? null, x[x.length - 1] ?? null],
        y: [s.gravimeter_depth_std_m, s.gravimeter_depth_std_m],
        line: { color: tokens.series2, width: 2, dash: 'dash' },
        hovertemplate: 'Depth ± %{y:.4~g} m<extra>Gravimeter only</extra>',
      },
      vertical(c.clock.sigma, 'Configured clock', tokens.truth, 'dot'),
    ]
    if (s.depth_gain_clock_sigma !== null) {
      const percent = Math.round((1 - s.depth_gain_threshold) * 100)
      data.push(vertical(s.depth_gain_clock_sigma, `Clock adds ${String(percent)} % depth information`, tokens.ink3, 'dash'))
    }
    const layout = baseLayout(tokens, {
      xaxis: axis(tokens, 'Clock uncertainty per station (fractional frequency, log scale)', { type: 'log', exponentformat: 'power', dtick: 1, autorange: 'reversed', showspikes: false }),
      yaxis: axis(tokens, 'Depth uncertainty, 1σ (m, log scale)', { type: 'log', exponentformat: 'power', showspikes: false }),
      margin: { l: 64, r: 16, t: 16, b: 52 },
      hovermode: 'closest',
      showlegend: true,
      legend: { orientation: 'h', x: 0, y: -0.22, yanchor: 'top', font: { size: 12, color: tokens.ink2 } },
      uirevision: 'clock-sweep',
    })
    const table: TableModel = {
      caption: 'Depth uncertainty (Cramér–Rao, 1σ) against clock accuracy.',
      columns: ['Clock σ per station', 'Clock only', 'Clock + gravimeter', 'Gravimeter only'],
      rowCount: x.length,
      row: (i) => [
        formatQuantity(x[i], 'fractional', { significant: 2 }),
        formatQuantity(s.clock_depth_std_m[i], 'length', { significant: 3 }),
        formatQuantity(s.joint_depth_std_m[i], 'length', { significant: 3 }),
        formatQuantity(s.gravimeter_depth_std_m, 'length', { significant: 3 }),
      ],
    }
    return { data, layout, table }
  }, [c, tokens])
  return (
    <ChartFrame
      id="clock-sweep-chart"
      title="How good must the clock be?"
      subtitle="Depth uncertainty of the first body as the clock improves (right). The joint survey can only beat the gravimeter once the clock carries comparable information."
      data={built.data}
      layout={built.layout}
      height={360}
      summary="Line chart of depth uncertainty against clock accuracy for clock only, gravimeter only and joint surveys."
      table={built.table}
      exportName="clock-vs-gravimeter-sweep"
      zoomable={false}
    />
  )
}

function DepthSweepChart({ c }: { c: InstrumentComparison }) {
  const { tokens } = useTheme()
  const built = useMemo(() => {
    const p = c.depth_sweep
    const data: Data[] = [
      { type: 'scatter', mode: 'lines', name: 'Clock', x: p.depths_m, y: p.clock_snr, line: { color: tokens.series1, width: 2 }, hovertemplate: 'Depth %{x:.4~g} m<br>SNR %{y:.3~g}<extra>Clock</extra>' },
      { type: 'scatter', mode: 'lines', name: c.gravimeter.label, x: p.depths_m, y: p.gravimeter_snr, line: { color: tokens.series2, width: 2 }, hovertemplate: 'Depth %{x:.4~g} m<br>SNR %{y:.3~g}<extra>Gravimeter</extra>' },
    ]
    const layout = baseLayout(tokens, {
      xaxis: axis(tokens, 'Depth of centre (m, log scale)', { type: 'log', exponentformat: 'power', dtick: 1, showspikes: false }),
      yaxis: axis(tokens, 'Expected SNR (log scale)', { type: 'log', exponentformat: 'power', dtick: 1, showspikes: false }),
      margin: { l: 64, r: 16, t: 16, b: 52 },
      hovermode: 'x unified',
      showlegend: true,
      legend: { orientation: 'h', x: 0, y: -0.22, yanchor: 'top', font: { size: 12, color: tokens.ink2 } },
      uirevision: 'depth-sweep',
    })
    const table: TableModel = {
      caption: 'Expected SNR of the configured mass against depth for both instruments.',
      columns: ['Depth', 'Clock SNR', 'Gravimeter SNR', 'Clock / gravimeter'],
      rowCount: p.depths_m.length,
      row: (i) => [
        formatQuantity(p.depths_m[i], 'length'),
        formatQuantity(p.clock_snr[i], 'ratio'),
        formatQuantity(p.gravimeter_snr[i], 'ratio'),
        formatQuantity(p.clock_to_gravimeter[i], 'ratio'),
      ],
    }
    return { data, layout, table }
  }, [c, tokens])
  const crossover = c.depth_sweep.crossover_depth_m
  return (
    <ChartFrame
      id="depth-sweep-chart"
      title="Clock and gravimeter against depth"
      subtitle={
        crossover === null
          ? `For ${formatQuantity(Math.abs(c.source.mass_kg), 'mass', { significant: 2 })} the gravimeter has the higher SNR at every depth shown.`
          : `For ${formatQuantity(Math.abs(c.source.mass_kg), 'mass', { significant: 2 })} the clock overtakes the gravimeter below ${formatQuantity(crossover, 'length', { significant: 2 })}.`
      }
      data={built.data}
      layout={built.layout}
      height={320}
      summary="Line chart of expected SNR against source depth for the clock and the gravimeter."
      table={built.table}
      exportName="clock-vs-gravimeter-depth"
      zoomable={false}
      footnote="Potential falls off as 1/r and gravity as z/r³, so the clock's relative standing improves with depth; removing each instrument's offset and drift takes away the part of a deep source's signal that is constant over the survey."
    />
  )
}

function nonNull(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null && v > 0)
}

interface Props {
  state: InstrumentState
  gravimeter: GravimeterKind
  onGravimeterChange: (value: GravimeterKind) => void
}

/** Would a gravimeter on the same stations do better, and does combining both help? (Bondarescu et al. 2012). */
export function InstrumentComparisonSection({ state, gravimeter, onGravimeterChange }: Props) {
  const c = state.status === 'done' ? state.comparison : state.status === 'pending' ? state.previous : null
  return (
    <section id="instruments" className={styles.study} aria-labelledby="instruments-title" aria-busy={state.status === 'pending'}>
      <header className={styles.studyHead}>
        <span className="eyebrow">Research question</span>
        <h2 id="instruments-title">Clock, gravimeter or both?</h2>
        <p>
          Bondarescu et al. (2012) proposed combining clocks with gravimeters because potential and gravity fall off differently with depth. The
          engine tests this on your stations: the same body, the same station-height errors, each instrument with its own offset and drift.
        </p>
      </header>
      <Segmented name="gravimeter-kind" ariaLabel="Gravimeter type" value={gravimeter} options={GRAVIMETER_OPTIONS} onChange={onGravimeterChange} />
      {state.status === 'idle' && <p className={styles.studyIdle}>Shown once the configuration is valid.</p>}
      {state.status === 'error' && <ErrorState compact error={state.error} />}
      {c ? (
        <>
          <Verdict c={c} />
          <CaseTable c={c} />
          <ClockSweepChart c={c} />
          <DepthSweepChart c={c} />
          <p className={styles.studyIdle}>
            {c.gravimeter.basis} {c.assumptions}
          </p>
        </>
      ) : (
        state.status === 'pending' && <Skeleton height={360} label="Comparing clock and gravimeter" />
      )}
    </section>
  )
}
