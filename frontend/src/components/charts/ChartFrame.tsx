import { Download, Move, RotateCcw, Table2, ZoomIn } from 'lucide-react'
import type { Data, Layout, PlotMouseEvent } from 'plotly.js-dist-min'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '../controls/Button'
import { ErrorBoundary } from '../feedback/ErrorBoundary'
import type { TableModel } from './DataTable'
import { DataTable } from './DataTable'
import type { ChartApi } from './PlotlyChart'
import { PlotlyChart } from './PlotlyChart'
import { preloadPlotly } from './plotly'
import styles from './charts.module.css'

export interface ChartEmpty {
  title: string
  message: string
}

interface ChartFrameProps {
  id: string
  title: string
  subtitle?: ReactNode
  controls?: ReactNode
  /** When set, the chart is replaced by an explanatory empty state. */
  empty?: ChartEmpty | null
  data: Data[]
  layout: Partial<Layout>
  height?: number
  /** Short text alternative describing what the chart shows. */
  summary: string
  table: TableModel | null
  footnote?: ReactNode
  exportName: string
  zoomable?: boolean
  onPointClick?: (event: PlotMouseEvent) => void
}

/**
 * Standard chart container: title, units in axis titles, zoom/pan/reset, PNG export,
 * table view, meaningful empty state and an error boundary so a chart failure stays local.
 */
export function ChartFrame({
  id,
  title,
  subtitle,
  controls,
  empty,
  data,
  layout,
  height = 320,
  summary,
  table,
  footnote,
  exportName,
  zoomable = true,
  onPointClick,
}: ChartFrameProps) {
  const [api, setApi] = useState<ChartApi | null>(null)
  const [mode, setMode] = useState<'zoom' | 'pan'>('zoom')
  const [showTable, setShowTable] = useState(false)
  const onReady = useCallback((next: ChartApi | null) => {
    setApi(next)
  }, [])
  const isEmpty = empty !== null && empty !== undefined

  // Load the chart library ahead of the first data (e.g. before a live run starts streaming).
  useEffect(() => preloadPlotly(), [])
  const [resetCount, setResetCount] = useState(0)
  // Plotly keeps user zoom/pan while uirevision is unchanged (live updates); bumping it resets the view.
  const plotLayout = useMemo(
    () => ({ ...layout, dragmode: mode, uirevision: `${String(layout.uirevision ?? id)}:${resetCount}` }),
    [layout, mode, id, resetCount],
  )

  return (
    <section className={styles.frame} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <h3 id={`${id}-title`} className={styles.title}>
            {title}
          </h3>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        <div className={styles.tools}>
          {controls}
          {!isEmpty && !showTable && zoomable && (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={mode === 'zoom' ? <Move /> : <ZoomIn />}
                disabled={api === null}
                aria-pressed={mode === 'pan'}
                onClick={() => {
                  setMode(mode === 'zoom' ? 'pan' : 'zoom')
                }}
              >
                {mode === 'zoom' ? 'Pan' : 'Zoom'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw />}
                onClick={() => {
                  setResetCount((n) => n + 1)
                }}
              >
                Reset
              </Button>
            </>
          )}
          {!isEmpty && table !== null && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Table2 />}
              aria-pressed={showTable}
              onClick={() => {
                setShowTable((v) => !v)
              }}
            >
              {showTable ? 'Chart' : 'Table'}
            </Button>
          )}
          {!isEmpty && !showTable && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Download />}
              disabled={api === null}
              aria-label={`Export ${title} as PNG`}
              onClick={() => api?.downloadPng(exportName)}
            >
              PNG
            </Button>
          )}
        </div>
      </header>
      <div className={styles.body}>
        {isEmpty ? (
          <div className={styles.empty} style={{ minHeight: Math.min(height, 200) }}>
            <strong>{empty.title}</strong>
            <span>{empty.message}</span>
          </div>
        ) : showTable && table !== null ? (
          <DataTable model={table} />
        ) : (
          <ErrorBoundary region={`${title} chart`} resetKeys={[data]}>
            <PlotlyChart data={data} layout={plotLayout} height={height} label={summary} onClick={onPointClick} onReady={onReady} />
          </ErrorBoundary>
        )}
      </div>
      {footnote && <p className={styles.footnote}>{footnote}</p>}
    </section>
  )
}
