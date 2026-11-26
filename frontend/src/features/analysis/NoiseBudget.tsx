import type { Data } from 'plotly.js-dist-min'
import { useMemo } from 'react'
import { useTheme } from '../../app/providers/themeContext'
import { ChartFrame } from '../../components/charts/ChartFrame'
import { axis, baseLayout } from '../../components/charts/chartTheme'
import type { TableModel } from '../../components/charts/DataTable'
import type { Comparison, NoiseComponent } from '../../types/api'
import { formatScientific } from '../../utils/format'

const KIND_LABEL: Record<NoiseComponent['kind'], string> = {
  white: 'White (per measurement)',
  station: 'Per station (fixed at each set-up)',
  correlated: 'Correlated',
  systematic: 'Systematic (over survey)',
}

/*
 * Three colour groups by how the noise behaves with averaging: a fourth categorical hue fails the
 * palette's all-pairs checks for a dot plot. Within the slowly varying group, marker shape separates
 * correlated noise from drift; the kind is also named in the hover text and the table.
 */
const GROUPS = [
  { name: 'Averages down (white)', kinds: ['white'] },
  { name: 'Fixed per station (does not average down)', kinds: ['station'] },
  { name: 'Slowly varying (correlated noise, drift)', kinds: ['correlated', 'systematic'] },
] as const satisfies readonly { name: string; kinds: readonly NoiseComponent['kind'][] }[]

const SYMBOL: Record<NoiseComponent['kind'], 'circle' | 'diamond'> = { white: 'circle', station: 'circle', correlated: 'circle', systematic: 'diamond' }

interface Props {
  components: readonly NoiseComponent[]
  nominalSigma: number
  comparison: Comparison
  exportName: string
}

/**
 * Noise budget on a logarithmic axis (magnitudes span decades), with the noise-free anomaly
 * amplitude as the reference: signal versus noise in one view. A dot plot is used because bars
 * on a log axis would imply an arbitrary baseline.
 */
export function NoiseBudget({ components, nominalSigma, comparison, exportName }: Props) {
  const { tokens } = useTheme()
  const built = useMemo(() => {
    const colors = [tokens.series1, tokens.series2, tokens.series3]
    const positive = components.filter((c) => c.sigma > 0)
    const labels = components.map((c) => c.label)
    const data: Data[] = GROUPS.map((group, g): Data | null => {
      const kinds: readonly NoiseComponent['kind'][] = group.kinds
      const items = positive.filter((c) => kinds.includes(c.kind))
      if (items.length === 0) return null
      return {
        type: 'scatter',
        mode: 'markers',
        name: group.name,
        x: items.map((c) => c.sigma),
        y: items.map((c) => c.label),
        marker: { size: 11, color: colors[g], symbol: items.map((c) => SYMBOL[c.kind]), line: { width: 2, color: tokens.surface } },
        customdata: items.map((c) => `${KIND_LABEL[c.kind]} · ${c.description}`),
        hovertemplate: '%{y}: σ = %{x:.3e}<br>%{customdata}<extra></extra>',
      }
    }).filter((d): d is Data => d !== null)
    const references = [
      { x: comparison.signal_amplitude_fractional, text: 'Anomaly amplitude (noise-free)', color: tokens.truth },
      { x: nominalSigma, text: 'Total noise σ per measurement', color: tokens.ink3 },
    ].filter((r) => r.x > 0)
    const layout = baseLayout(tokens, {
      xaxis: axis(tokens, 'Fractional frequency (Δf/f₀, log scale)', { type: 'log', showspikes: false }),
      yaxis: axis(tokens, '', { type: 'category', categoryarray: [...labels].reverse(), categoryorder: 'array', showspikes: false, automargin: true }),
      shapes: references.map((r) => ({
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: r.x,
        x1: r.x,
        y0: 0,
        y1: 1,
        line: { color: r.color, width: 1.5 },
      })),
      annotations: references.map((r, i) => ({
        x: Math.log10(r.x),
        y: 1,
        xref: 'x',
        yref: 'paper',
        yanchor: 'bottom',
        yshift: i * 14,
        text: r.text,
        showarrow: false,
        font: { size: 11, color: tokens.ink2 },
      })),
      margin: { l: 16, r: 16, t: 44, b: 44 },
      hovermode: 'closest',
      showlegend: true,
      legend: { orientation: 'h', x: 0, y: -0.25, yanchor: 'top', font: { size: 12, color: tokens.ink2 } },
      uirevision: 'noise-budget',
    })
    const table: TableModel = {
      caption: 'Noise budget per measurement in fractional frequency (engine noise model).',
      columns: ['Component', 'σ', 'Kind', 'Model'],
      rowCount: components.length,
      row: (i) => {
        const c = components[i]
        if (!c) return []
        return [c.label, c.sigma === 0 ? '0 (disabled)' : formatScientific(c.sigma, 3), KIND_LABEL[c.kind], c.description]
      },
    }
    const disabled = components.filter((c) => c.sigma === 0).map((c) => c.label)
    return { data, layout, table, disabled }
  }, [components, nominalSigma, comparison.signal_amplitude_fractional, tokens])

  return (
    <ChartFrame
      id="noise-budget"
      title="Noise budget vs signal"
      subtitle="Each noise source's standard deviation compared with the noise-free anomaly amplitude."
      data={built.data}
      layout={built.layout}
      height={300}
      summary="Noise components and the anomaly amplitude on a logarithmic axis."
      table={built.table}
      exportName={`${exportName}-noise-budget`}
      zoomable={false}
      footnote={built.disabled.length > 0 ? `Not shown (set to zero): ${built.disabled.join(', ')}.` : undefined}
    />
  )
}
