import type { Layout, LayoutAxis } from 'plotly.js-dist-min'
import type { ThemeTokens } from '../../app/providers/themeContext'

export function axis(tokens: ThemeTokens, title: string, extra: Partial<LayoutAxis> = {}): Partial<LayoutAxis> {
  return {
    title: { text: title, font: { size: 12, color: tokens.ink2 }, standoff: 8 },
    gridcolor: tokens.line,
    gridwidth: 1,
    linecolor: tokens.lineStrong,
    zerolinecolor: tokens.lineStrong,
    zerolinewidth: 1,
    tickfont: { family: tokens.fontMono, size: 11, color: tokens.ink3 },
    ticks: '',
    showline: true,
    automargin: true,
    exponentformat: 'power',
    showspikes: true,
    spikemode: 'across',
    spikesnap: 'cursor',
    spikethickness: 1,
    spikedash: 'solid',
    spikecolor: tokens.inkAxis,
    ...extra,
  }
}

export function baseLayout(tokens: ThemeTokens, overrides: Partial<Layout> = {}): Partial<Layout> {
  return {
    paper_bgcolor: tokens.surface,
    plot_bgcolor: tokens.surface,
    font: { family: tokens.fontSans, size: 12, color: tokens.ink2 },
    margin: { l: 56, r: 16, t: 8, b: 44 },
    separators: '. ',
    hoverlabel: {
      bgcolor: tokens.surface,
      bordercolor: tokens.lineStrong,
      font: { family: tokens.fontMono, size: 12, color: tokens.ink },
    },
    legend: {
      orientation: 'h',
      x: 0,
      xanchor: 'left',
      y: 1.02,
      yanchor: 'bottom',
      font: { size: 12, color: tokens.ink2 },
      bgcolor: 'rgba(0,0,0,0)',
    },
    dragmode: 'zoom',
    ...overrides,
  }
}

/** Diverging colorscale (negative → neutral → positive) for signed anomaly maps. */
export function divergingScale(tokens: ThemeTokens): [number, string][] {
  const stops = tokens.diverging
  return stops.map((color, i) => [i / (stops.length - 1), color])
}

/* Sequential single-hue ramp (blue, steps 100 → 700); the anchor flips in dark mode so low values recede into the surface. */
const BLUE_RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']

/** Sequential colorscale for unsigned quantities (heights, probabilities). */
export function sequentialScale(dark: boolean): [number, string][] {
  const ramp = dark ? [...BLUE_RAMP].reverse() : BLUE_RAMP
  return ramp.map((color, i) => [i / (ramp.length - 1), color])
}
