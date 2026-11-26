import type Plotly from 'plotly.js-dist-min'

export type PlotlyStatic = typeof Plotly

let loader: Promise<PlotlyStatic> | null = null

/** Loads Plotly on first use (it is large and only needed on chart views). */
export function loadPlotly(): Promise<PlotlyStatic> {
  loader ??= import('plotly.js-dist-min').then((module) => module.default)
  loader.catch(() => {
    loader = null
  })
  return loader
}

/**
 * Starts loading Plotly while the browser is idle, so its (large) evaluation cost is paid before
 * data starts streaming instead of blocking the first live chart update.
 */
export function preloadPlotly(): () => void {
  const start = () => {
    loadPlotly().catch(() => {
      // A load failure is reported by the chart that needs it (with a table-view fallback).
    })
  }
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(start, { timeout: 2000 })
    return () => {
      window.cancelIdleCallback(handle)
    }
  }
  const timer = globalThis.setTimeout(start, 200)
  return () => {
    globalThis.clearTimeout(timer)
  }
}
