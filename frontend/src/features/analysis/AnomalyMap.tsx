import type { Data, PlotMouseEvent } from 'plotly.js-dist-min'
import { useMemo, useState } from 'react'
import { useTheme } from '../../app/providers/themeContext'
import { ChartFrame } from '../../components/charts/ChartFrame'
import { axis, baseLayout, divergingScale } from '../../components/charts/chartTheme'
import type { TableModel } from '../../components/charts/DataTable'
import { Toggle } from '../../components/controls/Choice'
import type { Provenance } from '../../components/scientific/Quantity'
import { Quantity, Readout, Readouts } from '../../components/scientific/Quantity'
import type { AnomalyMapDoc, MapLayer, SourceEstimate, TruthBody } from '../../types/api'
import { formatNumber } from '../../utils/format'
import type { QuantityKind } from '../../utils/units'
import { axisTitle, lengthScale, maxAbs, scaleFor } from '../../utils/units'
import styles from './analysis.module.css'

interface LayerDefinition {
  id: MapLayer
  label: string
  kind: QuantityKind
  symbol: string
  provenance: Provenance
  note: string
}

const LAYERS: readonly LayerDefinition[] = [
  {
    id: 'gravity_anomaly_true',
    label: 'Gravity anomaly · forward model (ground truth)',
    kind: 'gravity_anomaly',
    symbol: 'Δg',
    provenance: 'truth',
    note: 'Noise-free gravity anomaly of the configured bodies at each sensor location.',
  },
  {
    id: 'gravity_anomaly_estimated',
    label: 'Gravity anomaly · model estimate',
    kind: 'gravity_anomaly',
    symbol: 'Δg',
    provenance: 'estimate',
    note: 'Gravity anomaly of the point sources reconstructed by the inversion.',
  },
  {
    id: 'observed_shift',
    label: 'Δf/f₀ · simulated measurement',
    kind: 'fractional',
    symbol: 'Δf/f₀',
    provenance: 'measurement',
    note: 'Measured fractional frequency shift after removing the known normal-field term. Excess mass lowers the potential, so clocks above it run slow (negative values).',
  },
  {
    id: 'filtered_shift',
    label: 'Δf/f₀ · filtered',
    kind: 'fractional',
    symbol: 'Δf/f₀',
    provenance: 'derived',
    note: 'Offset and drift removed by the inversion, Gaussian-smoothed for display.',
  },
  {
    id: 'residual',
    label: 'Residual (measurement − model)',
    kind: 'fractional',
    symbol: 'r',
    provenance: 'derived',
    note: 'What the inversion model does not explain; structure here indicates model misfit.',
  },
]

function nearestIndex(values: readonly number[], target: number): number {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  values.forEach((v, i) => {
    const d = Math.abs(v - target)
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  })
  return best
}

interface AnomalyMapProps {
  map: AnomalyMapDoc
  sources: readonly SourceEstimate[]
  truth: readonly TruthBody[]
  exportName: string
}

export function AnomalyMap({ map, sources, truth, exportName }: AnomalyMapProps) {
  const { tokens } = useTheme()
  const [layerId, setLayerId] = useState<MapLayer>('gravity_anomaly_true')
  const [showSources, setShowSources] = useState(true)
  const [selected, setSelected] = useState<{ i: number; j: number } | null>(null)
  const layer = LAYERS.find((l) => l.id === layerId) ?? LAYERS[0]
  const { layers, measurement_index: measurementIndex } = map

  const built = useMemo(() => {
    if (layer === undefined || layers === null || measurementIndex === null) return null
    const grid = layers[layer.id]
    const extent = Math.max(maxAbs(map.x_m), maxAbs(map.y_m))
    const xy = lengthScale(extent * 2)
    const x = map.x_m.map((v) => v * xy.factor)
    const y = map.y_m.map((v) => v * xy.factor)
    let peak = 0
    for (const row of grid) peak = Math.max(peak, maxAbs(row))
    const zScale = scaleFor(layer.kind, peak)
    const z = grid.map((row) => row.map((v) => v * zScale.factor))
    const bound = peak * zScale.factor || 1
    const unit = zScale.unit ? ` ${zScale.unit}` : ''
    const data: Data[] = [
      {
        type: 'heatmap',
        x,
        y,
        z,
        zsmooth: false,
        zmin: -bound,
        zmax: bound,
        zmid: 0,
        colorscale: divergingScale(tokens),
        colorbar: {
          title: { text: axisTitle(layer.symbol, zScale), side: 'right', font: { size: 11, color: tokens.ink2 } },
          thickness: 10,
          outlinewidth: 0,
          tickfont: { family: tokens.fontMono, size: 10, color: tokens.ink3 },
        },
        hovertemplate: `X %{x:.4~g} ${xy.unit}<br>Y %{y:.4~g} ${xy.unit}<br>${layer.symbol} %{z:.4g}${unit}<extra></extra>`,
        name: layer.label,
        showlegend: false,
      },
      {
        type: 'contour',
        x,
        y,
        z,
        contours: { coloring: 'lines', showlabels: false },
        colorscale: [
          [0, tokens.ink],
          [1, tokens.ink],
        ],
        line: { width: 0.7 },
        opacity: 0.45,
        showscale: false,
        hoverinfo: 'skip',
        showlegend: false,
        name: 'Contours',
      },
    ]
    if (showSources) {
      if (truth.length > 0) {
        data.push({
          type: 'scatter',
          mode: 'markers',
          name: 'Ground truth (body centre)',
          x: truth.map((b) => b.x_m * xy.factor),
          y: truth.map((b) => b.y_m * xy.factor),
          marker: { symbol: 'diamond-open', size: 12, color: tokens.truth, line: { width: 2, color: tokens.truth } },
          hovertemplate: `Ground truth<br>X %{x:.4~g} ${xy.unit}<br>Y %{y:.4~g} ${xy.unit}<extra></extra>`,
        })
      }
      if (sources.length > 0) {
        data.push({
          type: 'scatter',
          mode: 'markers',
          name: 'Model estimate (source centre)',
          x: sources.map((s) => s.x_m.estimate * xy.factor),
          y: sources.map((s) => s.y_m.estimate * xy.factor),
          marker: { symbol: 'circle', size: 10, color: tokens.series2, line: { width: 2, color: tokens.surface } },
          hovertemplate: `Model estimate<br>X %{x:.4~g} ${xy.unit}<br>Y %{y:.4~g} ${xy.unit}<extra></extra>`,
        })
      }
    }
    if (selected) {
      data.push({
        type: 'scatter',
        mode: 'markers',
        name: 'Selected point',
        x: [x[selected.i] ?? 0],
        y: [y[selected.j] ?? 0],
        marker: { symbol: 'square-open', size: 14, color: tokens.accent, line: { width: 2, color: tokens.accent } },
        hoverinfo: 'skip',
        showlegend: false,
      })
    }
    const layout = baseLayout(tokens, {
      xaxis: axis(tokens, axisTitle('X position (east)', xy), { showspikes: true, constrain: 'domain' }),
      yaxis: axis(tokens, axisTitle('Y position (north)', xy), { scaleanchor: 'x', scaleratio: 1, constrain: 'domain', showspikes: true }),
      hovermode: 'closest',
      showlegend: showSources && (truth.length > 0 || sources.length > 0),
      margin: { l: 56, r: 8, t: 8, b: 44 },
      uirevision: 'anomaly-map',
    })
    const table: TableModel = {
      caption: `${layer.label} on the ${map.nx} × ${map.ny} survey grid (engine values, no interpolation).`,
      columns: ['Row', 'Column', axisTitle('X', xy), axisTitle('Y', xy), axisTitle(layer.symbol, zScale)],
      rowCount: map.nx * map.ny,
      row: (k) => {
        const j = Math.floor(k / map.nx)
        const i = k % map.nx
        return [String(j), String(i), formatNumber(x[i] ?? Number.NaN, 5), formatNumber(y[j] ?? Number.NaN, 5), formatNumber(z[j]?.[i] ?? Number.NaN, 5)]
      },
    }
    return { data, layout, table, xy }
  }, [layer, layers, measurementIndex, map.x_m, map.y_m, map.nx, map.ny, tokens, showSources, truth, sources, selected])

  if (!map.available || built === null || layer === undefined) {
    return (
      <ChartFrame
        id="anomaly-map"
        title="Gravity anomaly map"
        empty={{ title: 'Anomaly map unavailable.', message: map.unavailable_reason ?? 'The engine did not return map data.' }}
        data={[]}
        layout={{}}
        summary="Anomaly map unavailable"
        table={null}
        exportName={exportName}
      />
    )
  }

  const onClick = (event: PlotMouseEvent) => {
    const point = event.points[0]
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return
    setSelected({ i: nearestIndex(map.x_m, point.x / built.xy.factor), j: nearestIndex(map.y_m, point.y / built.xy.factor) })
  }

  const cell = (name: MapLayer) => (selected && layers ? (layers[name][selected.j]?.[selected.i] ?? null) : null)
  const index = selected && measurementIndex ? (measurementIndex[selected.j]?.[selected.i] ?? null) : null

  return (
    <div className={styles.mapLayout}>
      <ChartFrame
        id="anomaly-map"
        title="Gravity anomaly map"
        subtitle={layer.note}
        controls={
          <>
            <label className={styles.inlineSelect}>
              <span>Layer</span>
              <select
                value={layerId}
                onChange={(event) => {
                  const next = LAYERS.find((l) => l.id === event.target.value)
                  if (next) setLayerId(next.id)
                }}
              >
                {LAYERS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <Toggle label="Source positions" checked={showSources} onChange={setShowSources} />
          </>
        }
        data={built.data}
        layout={built.layout}
        height={440}
        summary={`${layer.label} over a ${map.nx} by ${map.ny} grid.`}
        table={built.table}
        exportName={exportName}
        onPointClick={onClick}
        footnote="Cell colors are the engine's values at each measurement location (no interpolation); contour lines are interpolated between grid points to show shape without relying on color. Diverging scale centred on zero."
      />
      <aside className={styles.inspector} aria-live="polite" aria-label="Selected point">
        <h4>Point inspector</h4>
        {selected === null ? (
          <p className={styles.inspectorHint}>Click a cell on the map to inspect the values at that survey point.</p>
        ) : (
          <Readouts>
            <Readout label="Position">
              <Quantity value={map.x_m[selected.i]} kind="length" />, <Quantity value={map.y_m[selected.j]} kind="length" />
            </Readout>
            <Readout label="Gravity anomaly" provenance="model">
              <Quantity value={cell('gravity_anomaly_true')} kind="gravity_anomaly" />
            </Readout>
            <Readout label="Estimated gravity anomaly" provenance="estimate">
              <Quantity value={cell('gravity_anomaly_estimated')} kind="gravity_anomaly" />
            </Readout>
            <Readout label="Frequency shift Δf/f₀ (normal field removed)" provenance="measurement">
              <Quantity value={cell('observed_shift')} kind="fractional" />
            </Readout>
            <Readout label="Sensor measurement (raw Δf/f₀)" provenance="measurement">
              <Quantity value={cell('raw')} kind="fractional" />
            </Readout>
            <Readout label="Measurement index">
              <Quantity value={index} kind="count" />
            </Readout>
          </Readouts>
        )}
      </aside>
    </div>
  )
}
