import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../app/providers/ThemeProvider'
import { CompletionPanel } from '../features/simulation/CompletionPanel'
import scenarios from '../../../contract/scenarios.json'
import { parseDefaults } from '../api/schemas'
import { DetectabilitySection } from '../features/experiment/Detectability'
import { ScenarioPicker } from '../features/experiment/ScenarioPicker'
import { detectabilityJson, summaryJson } from '../test/fixtures'
import clockPresets from '../../../contract/clock-presets.json'
import defaults from '../../../contract/default-config.json'
import type { ExperimentConfig } from '../types/config'
import { MemoryRouter } from 'react-router'
import { ChartFrame } from './charts/ChartFrame'
import { NumberInput } from './controls/NumberField'
import { SliderField } from './controls/SliderField'
import { ErrorBoundary } from './feedback/ErrorBoundary'
import { EmptyState, ErrorState } from './feedback/States'
import { IntervalBar } from './scientific/IntervalBar'
import { Quantity } from './scientific/Quantity'
import { PhaseTimeline } from './simulation/PhaseTimeline'
import { StatusBadge } from './simulation/StatusBadge'

vi.mock('./charts/plotly', () => ({
  preloadPlotly: () => () => undefined,
  loadPlotly: () =>
    Promise.resolve({
      react: vi.fn((el: HTMLElement) => Promise.resolve(Object.assign(el, { on: vi.fn() }))),
      purge: vi.fn(),
      downloadImage: vi.fn(),
      Plots: { resize: vi.fn() },
    }),
}))

describe('scientific display', () => {
  it('shows units and never renders NaN', () => {
    const { rerender } = render(<Quantity value={102.4} kind="length" />)
    expect(screen.getByText('102.4 m')).toBeInTheDocument()
    rerender(<Quantity value={Number.NaN} kind="length" unavailableReason="Not computed." />)
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByText(': Not computed.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/NaN/)
  })

  it('describes a confidence interval with its values', () => {
    render(<IntervalBar label="Depth" estimate={102} low={96} high={107} kind="length" confidence={0.95} truth={100} />)
    expect(screen.getByRole('figure', { name: /estimate 102\.0 m, 95 % interval 96\.00 m to 107\.0 m, ground truth 100\.0 m/ })).toBeInTheDocument()
  })

  it('labels estimates as estimates and shows missing intervals as unavailable', () => {
    const summary = { ...summaryJson, primary_source: { ...summaryJson.primary_source, depth_ci_low: null, depth_ci_high: null } }
    render(
      <MemoryRouter>
        <CompletionPanel summary={summary} analysisHref="/x" />
      </MemoryRouter>,
    )
    expect(screen.getByText('Subsurface anomaly detected')).toBeInTheDocument()
    expect(screen.getAllByTitle('Model estimate').length).toBeGreaterThan(0)
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\b(accurate|confirmed|with certainty)\b/i)
  })
})

describe('detectability and scenarios', () => {
  it('states whether the configured body is detectable, with the engine values', () => {
    render(
      <ThemeProvider>
        <DetectabilitySection state={{ status: 'done', study: detectabilityJson(), key: 'k' }} />
      </ThemeProvider>,
    )
    const verdict = screen.getByText('Detectable:').closest('p')
    expect(verdict?.textContent).toMatch(/expected significance of 25σ against the 3σ criterion/)
    expect(verdict?.textContent).toMatch(/needs at least 1\.5 × 10¹² kg/)
    expect(screen.getByRole('heading', { name: 'Expected detection significance' })).toBeInTheDocument()
  })

  it('applies a research scenario and shows its expected outcome', async () => {
    const parsed = parseDefaults({ config: defaults, presets: clockPresets, scenarios }, 'defaults')
    const first = parsed.scenarios.scenarios[0]
    const second = parsed.scenarios.scenarios[1]
    if (!first || !second) throw new Error('expected scenarios')
    const applied: ExperimentConfig[] = []
    render(<ScenarioPicker scenarios={parsed.scenarios} config={first.config} onApply={(c) => applied.push(c)} />)
    expect(screen.getByText(first.expectation)).toBeInTheDocument()
    await userEvent.setup().selectOptions(screen.getByLabelText('Start from'), second.id)
    expect(applied).toEqual([second.config])
  })

  it('flags estimates as noise fits when nothing was detected', () => {
    render(
      <MemoryRouter>
        <CompletionPanel summary={{ ...summaryJson, anomaly_detected: false, detection_significance_sigma: 0.4 }} analysisHref="/x" />
      </MemoryRouter>,
    )
    expect(screen.getByText('No significant anomaly detected')).toBeInTheDocument()
    expect(document.body.textContent).toMatch(/best-fitting noise pattern, not a located body/)
  })
})

describe('controls', () => {
  function Controlled({ onValue }: { onValue: (v: number) => void }) {
    const [value, setValue] = useState(1500)
    return (
      <>
        <label htmlFor="depth">Depth</label>
        <NumberInput
          id="depth"
          value={value}
          onChange={(v) => {
            setValue(v)
            onValue(v)
          }}
          unit="m"
        />
        <button type="button" onClick={() => { setValue(42) }}>
          set
        </button>
      </>
    )
  }

  it('reports invalid text as NaN (for validation) and resyncs on external change', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Controlled onValue={onValue} />)
    const input = screen.getByLabelText('Depth')
    await user.clear(input)
    await user.type(input, 'abc')
    expect(onValue).toHaveBeenLastCalledWith(Number.NaN)
    expect(input).toHaveValue('abc')
    await user.click(screen.getByText('set'))
    expect(input).toHaveValue('42')
  })

  it('shows the current value beside a slider and moves on a log scale', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SliderField id="m" label="Mass" value={5e12} onChange={onChange} min={1e6} max={1e15} scale="log" unit="kg" readout="5.00 × 10¹² kg" valueText="5.00 × 10¹² kg" />)
    expect(screen.getByText('5.00 × 10¹² kg')).toBeInTheDocument()
    const slider = screen.getByRole('slider', { name: 'Mass slider' })
    // Log scale: position 1000 of 1000 is the maximum; the midpoint of 10⁶…10¹⁵ is ≈ 3.16 × 10¹⁰.
    fireEvent.change(slider, { target: { value: '1000' } })
    expect(onChange).toHaveBeenLastCalledWith(1e15)
    fireEvent.change(slider, { target: { value: '500' } })
    expect(onChange).toHaveBeenLastCalledWith(3.16e10)
    await user.tab()
  })
})

describe('feedback', () => {
  it('shows the actual reason, not a generic message', () => {
    render(<ErrorState error={{ title: 'Simulation failed', message: 'RuntimeError: singular matrix', code: 'simulation_error', retryable: true, engineUnavailable: false, fields: [] }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('RuntimeError: singular matrix')
    expect(document.body.textContent).not.toMatch(/something went wrong/i)
  })

  it('contains a failing region', () => {
    const Boom = () => {
      throw new Error('WebGL context lost')
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <div>
        <ErrorBoundary region="3D visualization">
          <Boom />
        </ErrorBoundary>
        <p>Charts still here</p>
      </div>,
    )
    expect(screen.getByText('3D visualization unavailable.')).toBeInTheDocument()
    expect(screen.getByText('Charts still here')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('renders meaningful empty states', () => {
    render(<EmptyState title="No experiments yet." message="Create your first simulation to begin." />)
    expect(screen.getByRole('heading', { name: 'No experiments yet.' })).toBeInTheDocument()
  })
})

describe('simulation status', () => {
  it('uses icon + label, not color alone', () => {
    render(<StatusBadge status="failed" />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('highlights the current stage and phase message', () => {
    render(<PhaseTimeline status="running" stage="measurement" phase="running_survey" />)
    expect(screen.getByText('Running survey…')).toBeInTheDocument()
    const current = screen.getByText('Measurement').closest('li')
    expect(current).toHaveAttribute('aria-current', 'step')
  })
})

describe('charts', () => {
  it('explains an empty chart instead of drawing nothing', () => {
    render(
      <ThemeProvider>
        <ChartFrame id="c" title="Fractional frequency shift" empty={{ title: 'No measurements available yet.', message: 'Run the simulation to generate sensor data.' }} data={[]} layout={{}} summary="" table={null} exportName="x" />
      </ThemeProvider>,
    )
    expect(screen.getByText('No measurements available yet.')).toBeInTheDocument()
    expect(screen.getByText('Run the simulation to generate sensor data.')).toBeInTheDocument()
  })

  it('offers a table view of the plotted data', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <ChartFrame
          id="c"
          title="Signal"
          data={[{ type: 'scatter', x: [1], y: [2] }]}
          layout={{}}
          summary="Signal"
          table={{ caption: 'Signal data', columns: ['Index', 'Value'], rowCount: 30, row: (i) => [String(i), String(i * 2)] }}
          exportName="x"
        />
      </ThemeProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByRole('table', { name: 'Signal data' })).toBeInTheDocument()
    expect(screen.getByText('Rows 1–25 of 30')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Rows 26–30 of 30')).toBeInTheDocument()
  })
})
