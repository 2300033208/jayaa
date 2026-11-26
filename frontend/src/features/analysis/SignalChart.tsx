import { useMemo, useState } from 'react'
import { useTheme } from '../../app/providers/themeContext'
import { ChartFrame } from '../../components/charts/ChartFrame'
import { Toggle } from '../../components/controls/Choice'
import { useThrottledValue } from '../../hooks/useThrottledValue'
import type { SignalId, SignalSource } from './signals'
import { SIGNALS, SIGNAL_IDS, buildSignalChart } from './signals'
import styles from './analysis.module.css'

const MAX_RENDER_POINTS = 20_000
const LIVE_INTERVAL_MS = 250

interface SignalChartProps {
  id: string
  source: SignalSource
  initialSignal?: SignalId
  live: boolean
  /** Whether a run is pending or in progress (defaults to `live`); selects the empty-state wording. */
  awaitingData?: boolean
  exportName: string
  height?: number
}

/** Signal viewer used on the Simulation (live) and Analysis (complete dataset) pages. */
export function SignalChart({ id, source, initialSignal = 'fractional_shift', live, awaitingData = live, exportName, height = 300 }: SignalChartProps) {
  const { tokens } = useTheme()
  const [signal, setSignal] = useState<SignalId>(initialSignal)
  const [showModel, setShowModel] = useState(false)
  const [showEstimate, setShowEstimate] = useState(true)
  const count = useThrottledValue(source.count, live ? LIVE_INTERVAL_MS : 0)
  const definition = SIGNALS[signal]
  const { buffer, processed } = source

  const built = useMemo(
    () =>
      buildSignalChart(definition, { buffer, count, processed }, tokens, {
        showModel,
        showEstimate,
        maxPoints: MAX_RENDER_POINTS,
        awaitingData,
      }),
    [definition, buffer, count, processed, tokens, showModel, showEstimate, awaitingData],
  )

  const controls = (
    <>
      <label className={styles.inlineSelect}>
        <span>Signal</span>
        <select
          value={signal}
          onChange={(event) => {
            const next = SIGNAL_IDS.find((s) => s === event.target.value)
            if (next) setSignal(next)
          }}
        >
          {SIGNAL_IDS.map((s) => (
            <option key={s} value={s}>
              {SIGNALS[s].label}
            </option>
          ))}
        </select>
      </label>
      {signal === 'fractional_shift' && (
        <Toggle label="Noise-free model" checked={showModel} onChange={setShowModel} />
      )}
      {signal === 'fractional_shift' && processed !== null && (
        <Toggle label="Model estimate" checked={showEstimate} onChange={setShowEstimate} />
      )}
    </>
  )

  const originNote =
    definition.origin === 'model'
      ? 'Forward model (noise-free), computed by the engine.'
      : definition.origin === 'processed'
        ? 'Processed by the engine after the survey.'
        : definition.origin === 'internal'
          ? 'Simulator internal: a real sensor cannot observe this series.'
          : 'Simulated measurements streamed from the engine.'

  return (
    <ChartFrame
      id={id}
      title={`${definition.label} (${definition.symbol})`}
      subtitle={definition.description}
      controls={controls}
      empty={built.empty}
      data={built.data}
      layout={built.layout}
      height={height}
      summary={built.summary}
      table={built.table}
      exportName={exportName}
      footnote={
        <>
          {originNote}
          {built.reduced && (
            <>
              {' '}
              <strong>
                Rendering {built.reduced.shown.toLocaleString('en-US')} of {built.reduced.total.toLocaleString('en-US')} points
              </strong>{' '}
              (min/max envelope per bucket, display only). The table view and exports contain every measurement.
            </>
          )}
        </>
      }
    />
  )
}
