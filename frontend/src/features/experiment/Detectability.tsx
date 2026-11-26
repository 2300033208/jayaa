
import type { Data } from 'plotly.js-dist-min'
import { useMemo } from 'react'
import { useTheme } from '../../app/providers/themeContext'
import { ChartFrame } from '../../components/charts/ChartFrame'
import { axis, baseLayout } from '../../components/charts/chartTheme'
import type { TableModel } from '../../components/charts/DataTable'
import { ErrorState, Skeleton } from '../../components/feedback/States'
import { Quantity } from '../../components/scientific/Quantity'
import type { DetectabilityStudy } from '../../types/api'
import { formatQuantity } from '../../utils/units'
import type { DetectabilityState } from './useDetectability'
import styles from './experiment.module.css'

/* Sequential single-hue ramp (blue, steps 100 → 700); the anchor flips in dark mode so "near zero" recedes into the surface. */
const BLUE_RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']
/** Colours saturate here; larger significances are shown by value in hover and the table. */
const COLOR_CAP_SIGMA = 10

function colorscale(dark: boolean): [number, string][] {
  const ramp = dark ? [...BLUE_RAMP].reverse() : BLUE_RAMP
  return ramp.map((color, i) => [i / (ramp.length - 1), color])
}

function Verdict({ study }: { study: DetectabilityStudy }) {
  const body = study.bodies[0]
  const expected = body?.expected_significance_sigma ?? null
  if (!body || expected === null) return null
  const detectable = expected >= study.threshold_sigma
  // Minimum detectable mass on the engine's depth grid row closest to the body (log distance).
  let row = 0
  study.depths_m.forEach((d, i) => {
    const best = study.depths_m[row] ?? d
    if (Math.abs(Math.log(d / body.depth_m)) < Math.abs(Math.log(best / body.depth_m))) row = i
  })
  const minimum = study.min_detectable_mass_kg[row] ?? null
  return (
    <p className={styles.verdict} data-detectable={detectable}>
      <strong>{detectable ? 'Detectable' : 'Not detectable'}:</strong> the configured body (<Quantity value={body.mass_kg} kind="mass" significant={2} /> at{' '}
      <Quantity value={body.depth_m} kind="length" />) gives an expected significance of <Quantity value={expected} kind="sigma" /> against the{' '}
      {study.threshold_sigma}σ criterion.
      {minimum !== null && (
        <>
          {' '}
          At about <Quantity value={study.depths_m[row] ?? null} kind="length" significant={2} /> depth this campaign needs at least{' '}
          <Quantity value={minimum} kind="mass" significant={2} />.
        </>
      )}
    </p>
  )
}

function StudyChart({ study }: { study: DetectabilityStudy }) {
  const { tokens, resolved } = useTheme()
  const built = useMemo(() => {
    const capped = study.significance_sigma.map((row) => row.map((v) => Math.min(v, COLOR_CAP_SIGMA)))
    const thresholdPoints = study.depths_m
      .map((depth, i) => ({ depth, mass: study.min_detectable_mass_kg[i] ?? null }))
      .filter((p): p is { depth: number; mass: number } => p.mass !== null)
    const masses = study.masses_kg
    const inRange = thresholdPoints.filter((p) => p.mass >= (masses[0] ?? 0) && p.mass <= (masses[masses.length - 1] ?? 0))
    const data: Data[] = [
      {
        type: 'heatmap',
        x: masses,
        y: study.depths_m,
        z: capped,
        // Uncapped values for hover (colours saturate at the cap).
        text: study.significance_sigma.map((row) => row.map((v) => formatQuantity(v, 'sigma'))),
        zmin: 0,
        zmax: COLOR_CAP_SIGMA,
        colorscale: colorscale(resolved === 'dark'),
        colorbar: {
          title: { text: 'Expected σ', font: { size: 11, color: tokens.ink2 } },
          tickfont: { size: 11, color: tokens.ink2 },
          ticksuffix: 'σ',
          thickness: 12,
          outlinewidth: 0,
        },
        hovertemplate: 'Mass %{x:.2e} kg<br>Depth %{y:.4~g} m<br>Expected %{text}<extra></extra>',
      },
      {
        type: 'scatter',
        mode: 'lines',
        name: `${study.threshold_sigma}σ detection threshold`,
        x: inRange.map((p) => p.mass),
        y: inRange.map((p) => p.depth),
        line: { color: tokens.ink, width: 2, dash: 'dash' },
        hovertemplate: `Minimum detectable mass %{x:.2e} kg<br>at %{y:.4~g} m<extra></extra>`,
      },
      {
        type: 'scatter',
        mode: 'markers',
        name: 'Configured body',
        x: study.bodies.map((b) => b.mass_kg),
        y: study.bodies.map((b) => b.depth_m),
        marker: { symbol: 'diamond', size: 12, color: tokens.truth, line: { width: 2, color: tokens.surface } },
        customdata: study.bodies.map((b) => b.id),
        hovertemplate: 'Configured body %{customdata}<br>Mass %{x:.2e} kg<br>Depth %{y:.4~g} m<extra></extra>',
      },
    ]
    const layout = baseLayout(tokens, {
      xaxis: axis(tokens, 'Buried mass (kg, log scale)', { type: 'log', exponentformat: 'power', dtick: 1, showspikes: false }),
      yaxis: axis(tokens, 'Depth of centre (m, log scale)', { type: 'log', autorange: 'reversed', dtick: 1, showspikes: false }),
      margin: { l: 64, r: 16, t: 16, b: 52 },
      hovermode: 'closest',
      showlegend: true,
      legend: { orientation: 'h', x: 0, y: -0.2, yanchor: 'top', font: { size: 12, color: tokens.ink2 } },
      uirevision: 'detectability',
    })
    const cols = masses.length
    const table: TableModel = {
      caption: 'Expected detection significance by depth and mass (engine detectability study).',
      columns: ['Depth', 'Mass', 'Expected significance'],
      rowCount: study.depths_m.length * cols,
      row: (i) => {
        const d = study.depths_m[Math.floor(i / cols)]
        const m = masses[i % cols]
        const z = study.significance_sigma[Math.floor(i / cols)]?.[i % cols]
        if (d === undefined || m === undefined || z === undefined) return []
        return [formatQuantity(d, 'length'), formatQuantity(m, 'mass', { significant: 2 }), formatQuantity(z, 'sigma')]
      },
    }
    return { data, layout, table }
  }, [study, tokens, resolved])

  return (
    <ChartFrame
      id="detectability-chart"
      title="Expected detection significance"
      subtitle={`Point source at x = ${formatQuantity(study.position.x_m, 'length')}, y = ${formatQuantity(study.position.y_m, 'length')}; ${study.station_count} stations.`}
      data={built.data}
      layout={built.layout}
      height={380}
      summary="Heatmap of expected detection significance over buried mass and depth, with the detection threshold line and the configured body."
      table={built.table}
      exportName="detectability"
      zoomable={false}
      footnote={`${study.assumptions} Colours saturate at ${COLOR_CAP_SIGMA}σ. Depths start at the resolution limit (${formatQuantity(study.resolution_depth_m, 'length')}).`}
    />
  )
}

/** Which buried masses could this campaign detect? Engine-computed before any simulation runs. */
export function DetectabilitySection({ state }: { state: DetectabilityState }) {
  const study = state.status === 'done' ? state.study : state.status === 'pending' ? state.previous : null
  return (
    <section id="detectability" className={styles.study} aria-labelledby="detectability-title" aria-busy={state.status === 'pending'}>
      <header className={styles.studyHead}>
        <span className="eyebrow">Before you run</span>
        <h2 id="detectability-title">Detectability study</h2>
        <p>
          Which buried masses could this site, survey and clock detect? The engine evaluates the same detection test a completed run uses, for a
          range of masses and depths at the first body&apos;s position.
        </p>
      </header>
      {state.status === 'idle' && <p className={styles.studyIdle}>Shown once the configuration is valid.</p>}
      {state.status === 'error' && <ErrorState compact error={state.error} />}
      {study ? (
        <>
          <Verdict study={study} />
          <StudyChart study={study} />
        </>
      ) : (
        state.status === 'pending' && <Skeleton height={380} label="Computing detectability study" />
      )}
    </section>
  )
}
