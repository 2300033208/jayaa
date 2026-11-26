import type { Config, Data, Layout, PlotMouseEvent, PlotlyHTMLElement } from 'plotly.js-dist-min'
import { useEffect, useRef, useState } from 'react'
import type { PlotlyStatic } from './plotly'
import { loadPlotly } from './plotly'
import styles from './charts.module.css'

export interface ChartApi {
  downloadPng: (filename: string) => void
}

interface PlotlyChartProps {
  data: Data[]
  layout: Partial<Layout>
  height: number
  label: string
  onClick?: (event: PlotMouseEvent) => void
  onReady?: (api: ChartApi | null) => void
}

/**
 * Plotly's typings declare Plots.resize as returning void, but at runtime it returns a Promise
 * that rejects for undisplayed plots. This wrapper restores the real contract so the rejection
 * is always handled.
 */
function resizePlot(plotly: PlotlyStatic, el: HTMLElement): Promise<unknown> {
  const resize = plotly.Plots.resize.bind(plotly.Plots) as unknown as (root: HTMLElement) => Promise<unknown> | undefined
  return Promise.resolve(resize(el))
}

const CONFIG: Partial<Config> = {
  displaylogo: false,
  responsive: false,
  scrollZoom: false,
  displayModeBar: 'hover',
  modeBarButtonsToRemove: ['lasso2d', 'select2d', 'toggleSpikelines', 'hoverCompareCartesian', 'hoverClosestCartesian'],
}

/**
 * Minimal Plotly binding. Plotly is loaded lazily, updated with Plotly.react (no remount),
 * resized with a ResizeObserver and purged on unmount so no listeners or WebGL contexts leak.
 */
export function PlotlyChart({ data, layout, height, label, onClick, onReady }: PlotlyChartProps) {
  const container = useRef<HTMLDivElement>(null)
  const [plotly, setPlotly] = useState<PlotlyStatic | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const clickRef = useRef(onClick)
  const readyRef = useRef(onReady)

  useEffect(() => {
    clickRef.current = onClick
    readyRef.current = onReady
  })

  useEffect(() => {
    let active = true
    loadPlotly().then(
      (module) => {
        if (active) setPlotly(() => module)
      },
      (error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Chart library failed to load')
      },
    )
    return () => {
      active = false
    }
  }, [])

  // Purge on unmount only.
  useEffect(() => {
    const el = container.current
    return () => {
      if (plotly && el) {
        readyRef.current?.(null)
        plotly.purge(el)
      }
    }
  }, [plotly])

  useEffect(() => {
    const el = container.current
    if (!plotly || !el) return
    let cancelled = false
    plotly.react(el, data, { ...layout, height, autosize: true }, CONFIG).then((graph: PlotlyHTMLElement) => {
      if (cancelled) return
      if (graph.dataset.bound !== '1') {
        graph.dataset.bound = '1'
        graph.on('plotly_click', (event) => {
          clickRef.current?.(event)
        })
        readyRef.current?.({
          downloadPng: (filename) => {
            plotly.downloadImage(graph, { format: 'png', filename, width: graph.clientWidth * 2, height: height * 2 }).catch((error: unknown) => {
              console.error('PNG export failed', error)
            })
          },
        })
      }
    }, (error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Chart rendering failed')
    })
    return () => {
      cancelled = true
    }
  }, [plotly, data, layout, height])

  useEffect(() => {
    const el = container.current
    if (!plotly || !el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      // Hidden charts (table view, collapsed layout) have nothing to resize.
      if (el.dataset.bound !== '1' || el.offsetParent === null) return
      resizePlot(plotly, el).catch(() => {
        // The element was hidden between the check and the resize; the next observation retries.
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [plotly])

  if (loadError !== null) {
    return (
      <div className={styles.chartFallback} style={{ height }} role="alert">
        Chart unavailable: {loadError}. Use the table view to inspect the data.
      </div>
    )
  }
  return (
    <div className={styles.plotHost} style={{ minHeight: height }}>
      {/* figure (not img): Plotly renders interactive controls inside the plot. */}
      <div ref={container} role="figure" aria-label={label} className={styles.plot} />
      {!plotly && <div className={styles.chartLoading} aria-hidden="true" />}
    </div>
  )
}
