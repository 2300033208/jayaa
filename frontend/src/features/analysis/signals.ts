import type { Data, Layout } from 'plotly.js-dist-min'
import type { ThemeTokens } from '../../app/providers/themeContext'
import { axis, baseLayout } from '../../components/charts/chartTheme'
import type { ChartEmpty } from '../../components/charts/ChartFrame'
import type { TableModel } from '../../components/charts/DataTable'
import type { MeasurementField, SignalsDoc } from '../../types/api'
import { minMaxDecimate, pick } from '../../utils/downsample'
import { formatInteger, formatNumber } from '../../utils/format'
import type { DisplayScale, QuantityKind } from '../../utils/units'
import { axisTitle, formatQuantity, maxAbs, scaleFor } from '../../utils/units'
import type { MeasurementBuffer } from '../simulation/measurementBuffer'

export const SIGNAL_IDS = [
  'fractional_shift',
  'potential',
  'gravity',
  'gravity_anomaly',
  'absolute_shift',
  'ai_phase',
  'raw',
  'filtered',
  'noise',
  'residual',
] as const
export type SignalId = (typeof SIGNAL_IDS)[number]

type SignalOrigin = 'model' | 'measurement' | 'processed' | 'internal'

export interface SignalDefinition {
  id: SignalId
  label: string
  symbol: string
  kind: QuantityKind
  axis: 'along_track' | 'time'
  origin: SignalOrigin
  description: string
  /** Source column in the measurement stream, when the signal comes from the stream. */
  column?: MeasurementField
  /** Processed series from the engine's analysis output. */
  processed?: 'filtered' | 'residual'
  tickformat?: string
}

export const SIGNALS: Record<SignalId, SignalDefinition> = {
  fractional_shift: {
    id: 'fractional_shift',
    label: 'Fractional frequency shift',
    symbol: 'Δf/f₀',
    kind: 'fractional',
    axis: 'along_track',
    origin: 'measurement',
    column: 'raw',
    description: 'Simulated clock comparison Δf/f₀ at each survey point (includes noise and drift).',
  },
  potential: {
    id: 'potential',
    label: 'Gravitational potential',
    symbol: 'ΔΦ',
    kind: 'potential',
    axis: 'along_track',
    origin: 'model',
    column: 'potential_m2_s2',
    description: 'Potential at the sensor relative to the reference clock. Forward model, noise-free.',
  },
  gravity: {
    id: 'gravity',
    label: 'Gravity',
    symbol: 'g',
    kind: 'gravity',
    axis: 'along_track',
    origin: 'model',
    column: 'gravity_m_s2',
    description: 'Total gravity (normal field plus anomaly) at the sensor. Forward model, noise-free.',
    tickformat: '.7f',
  },
  gravity_anomaly: {
    id: 'gravity_anomaly',
    label: 'Gravity anomaly',
    symbol: 'Δg',
    kind: 'gravity_anomaly',
    axis: 'along_track',
    origin: 'model',
    column: 'gravity_anomaly_m_s2',
    description: 'Gravity produced by the subsurface bodies alone. Forward model, noise-free.',
  },
  absolute_shift: {
    id: 'absolute_shift',
    label: 'Absolute frequency shift',
    symbol: 'Δf',
    kind: 'frequency_shift',
    axis: 'along_track',
    origin: 'model',
    column: 'absolute_shift_hz',
    description: 'Gravitational frequency shift f₀·ΔΦ/c² in hertz. Forward model, noise-free.',
  },
  ai_phase: {
    id: 'ai_phase',
    label: 'Atom-interferometer phase',
    symbol: 'Δφ',
    kind: 'phase',
    axis: 'along_track',
    origin: 'model',
    column: 'ai_phase_rad',
    description: 'Equivalent atom-interferometer phase anomaly k_eff·Δg·T² (Rb, T = 0.1 s). Forward model.',
  },
  raw: {
    id: 'raw',
    label: 'Raw sensor signal',
    symbol: 'Δf/f₀',
    kind: 'fractional',
    axis: 'time',
    origin: 'measurement',
    column: 'raw',
    description: 'Clock comparison output versus survey time, before any processing (drift visible).',
  },
  filtered: {
    id: 'filtered',
    label: 'Filtered signal',
    symbol: 'Δf/f₀',
    kind: 'fractional',
    axis: 'along_track',
    origin: 'processed',
    processed: 'filtered',
    description: 'Offset and drift removed by the joint inversion, Gaussian-smoothed for display.',
  },
  noise: {
    id: 'noise',
    label: 'Noise',
    symbol: 'ε',
    kind: 'fractional',
    axis: 'time',
    origin: 'internal',
    column: 'noise',
    description: 'Injected stochastic noise realization (simulator internal, not observable by a real sensor).',
  },
  residual: {
    id: 'residual',
    label: 'Residual',
    symbol: 'r',
    kind: 'fractional',
    axis: 'along_track',
    origin: 'processed',
    processed: 'residual',
    description: 'Measurement minus the inversion model prediction.',
  },
}

export const SERIES_NAMES = {
  measurement: 'Simulated measurement',
  model: 'Noise-free forward model (ground truth)',
  estimate: 'Model estimate (inversion)',
  processed: 'Processed signal',
  internal: 'Injected noise (simulator internal)',
} as const

export interface SignalSource {
  buffer: MeasurementBuffer
  count: number
  processed: SignalsDoc | null
}

export interface SignalChartOptions {
  showModel: boolean
  showEstimate: boolean
  maxPoints: number
  /** True when a run is pending or in progress, so an empty chart means "not yet", not "none". */
  awaitingData: boolean
}

export interface BuiltChart {
  data: Data[]
  layout: Partial<Layout>
  table: TableModel | null
  empty: ChartEmpty | null
  summary: string
  reduced: { shown: number; total: number } | null
}

function emptyChart(empty: ChartEmpty, summary: string): BuiltChart {
  return { data: [], layout: {}, table: null, empty, summary, reduced: null }
}

/** Values of a processed engine series aligned to buffer rows via the measurement index. */
function processedColumn(values: readonly number[], indices: Float64Array, n: number): Float64Array | null {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    const idx = indices[i] ?? -1
    const v = values[idx]
    if (v === undefined) return null
    out[i] = v
  }
  return out
}

export function buildSignalChart(
  definition: SignalDefinition,
  source: SignalSource,
  tokens: ThemeTokens,
  options: SignalChartOptions,
): BuiltChart {
  const n = Math.min(source.count, source.buffer.length)
  const title = `${definition.label} (${definition.symbol})`
  if (n === 0) {
    return emptyChart(
      options.awaitingData
        ? { title: 'No measurements available yet.', message: 'Run the simulation to generate sensor data.' }
        : { title: 'No measurements recorded.', message: 'This simulation produced no measurements.' },
      `${title}: no data`,
    )
  }
  if (n < 2) {
    return emptyChart(
      { title: 'Insufficient measurements for visualization.', message: 'At least two measurements are needed to draw a signal.' },
      `${title}: insufficient data`,
    )
  }

  const indices = source.buffer.column('index').subarray(0, n)
  let primary: Float64Array
  if (definition.processed) {
    if (source.processed === null) {
      return emptyChart(
        {
          title: 'Available after signal processing.',
          message: 'The engine computes this signal after the survey completes and the inversion has run.',
        },
        `${title}: not yet available`,
      )
    }
    const aligned = processedColumn(source.processed[definition.processed], indices, n)
    if (aligned === null) {
      return emptyChart(
        { title: 'Processed data does not match the measurements.', message: 'Reload the analysis to fetch a consistent dataset.' },
        `${title}: inconsistent data`,
      )
    }
    primary = aligned
  } else {
    primary = source.buffer.column(definition.column ?? 'raw').subarray(0, n)
  }

  const modelColumn = definition.id === 'fractional_shift' && options.showModel ? source.buffer.column('fractional_shift').subarray(0, n) : null
  const estimateColumn =
    definition.id === 'fractional_shift' && options.showEstimate && source.processed !== null
      ? processedColumn(source.processed.model_prediction, indices, n)
      : null

  const xRaw = source.buffer.column(definition.axis === 'time' ? 'timestamp_s' : 'along_track_m').subarray(0, n)
  const xScale: DisplayScale = scaleFor(definition.axis === 'time' ? 'duration' : 'length', maxAbs(xRaw))
  const xLabel = definition.axis === 'time' ? 'Survey time' : 'Along-track distance'

  let range = maxAbs(primary)
  if (modelColumn) range = Math.max(range, maxAbs(modelColumn))
  if (estimateColumn) range = Math.max(range, maxAbs(estimateColumn))
  const yScale: DisplayScale = scaleFor(definition.kind, range)

  const decimated = minMaxDecimate(primary, options.maxPoints)
  const idx = decimated.indices
  const x = pick(xRaw, idx, xScale.factor)
  const gl = idx.length > 3000
  const unitSuffix = yScale.unit ? ` ${yScale.unit}` : ''
  const hover = (name: string) => `%{y:.4g}${unitSuffix}<extra>${name}</extra>`

  const data: Data[] = []
  const primaryName =
    definition.origin === 'model'
      ? SERIES_NAMES.model
      : definition.origin === 'processed'
        ? SERIES_NAMES.processed
        : definition.origin === 'internal'
          ? SERIES_NAMES.internal
          : SERIES_NAMES.measurement
  const asLine = definition.origin === 'model' || definition.id === 'filtered'
  data.push({
    type: gl ? 'scattergl' : 'scatter',
    mode: asLine ? 'lines' : 'markers',
    name: primaryName,
    x,
    y: pick(primary, idx, yScale.factor),
    marker: { color: definition.origin === 'model' ? tokens.truth : tokens.series1, size: idx.length > 2000 ? 4 : 6, opacity: 0.8 },
    line: { color: definition.origin === 'model' ? tokens.truth : tokens.series1, width: definition.origin === 'model' ? 1.5 : 2 },
    hovertemplate: hover(primaryName),
  })
  if (modelColumn) {
    data.push({
      type: gl ? 'scattergl' : 'scatter',
      mode: 'lines',
      name: SERIES_NAMES.model,
      x,
      y: pick(modelColumn, idx, yScale.factor),
      line: { color: tokens.truth, width: 1.5 },
      hovertemplate: hover(SERIES_NAMES.model),
    })
  }
  if (estimateColumn) {
    data.push({
      type: gl ? 'scattergl' : 'scatter',
      mode: 'lines',
      name: SERIES_NAMES.estimate,
      x,
      y: pick(estimateColumn, idx, yScale.factor),
      line: { color: tokens.series2, width: 2 },
      hovertemplate: hover(SERIES_NAMES.estimate),
    })
  }

  const layout = baseLayout(tokens, {
    xaxis: axis(tokens, axisTitle(xLabel, xScale)),
    yaxis: axis(tokens, axisTitle(definition.symbol, yScale), definition.tickformat ? { tickformat: definition.tickformat } : {}),
    showlegend: data.length > 1,
    hovermode: idx.length <= 4000 ? 'x unified' : 'closest',
    uirevision: definition.id,
  })

  const columns = ['Index', axisTitle(xLabel, xScale), 'Position (m)', `${definition.symbol}${yScale.unit ? ` (${yScale.unit})` : ''}`]
  if (modelColumn) columns.push('Forward model')
  if (estimateColumn) columns.push('Model estimate')
  const xs = source.buffer.column('x_m')
  const ys = source.buffer.column('y_m')
  const table: TableModel = {
    caption: `${definition.label}: ${n.toLocaleString('en-US')} rows at full precision (display units). ${definition.description}`,
    columns,
    rowCount: n,
    row: (i) => {
      const cells = [
        formatInteger(indices[i] ?? Number.NaN),
        formatNumber((xRaw[i] ?? Number.NaN) * xScale.factor, 6),
        `${formatNumber(xs[i] ?? Number.NaN, 5)}, ${formatNumber(ys[i] ?? Number.NaN, 5)}`,
        formatNumber((primary[i] ?? Number.NaN) * yScale.factor, 6),
      ]
      if (modelColumn) cells.push(formatNumber((modelColumn[i] ?? Number.NaN) * yScale.factor, 6))
      if (estimateColumn) cells.push(formatNumber((estimateColumn[i] ?? Number.NaN) * yScale.factor, 6))
      return cells
    },
  }

  const last = primary[n - 1] ?? Number.NaN
  const summary = `${title} for ${n} measurements. Latest value ${formatQuantity(last, definition.kind)}.`
  return {
    data,
    layout,
    table,
    empty: null,
    summary,
    reduced: decimated.reduced ? { shown: idx.length, total: n } : null,
  }
}
