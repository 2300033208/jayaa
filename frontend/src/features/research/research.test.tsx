import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParseError } from '../../api/parse'
import { parseBenchmarks, parseInstrumentComparison } from '../../api/researchSchemas'
import { ThemeProvider } from '../../app/providers/ThemeProvider'
import Validation from '../../pages/Validation'
import benchmarksJson from '../../test/benchmarks.json'
import comparisonJson from '../../test/instrumentComparison.json'
import { InstrumentComparisonSection } from './InstrumentComparison'

vi.mock('../../components/charts/plotly', () => ({
  preloadPlotly: () => () => undefined,
  loadPlotly: () =>
    Promise.resolve({
      react: vi.fn((el: HTMLElement) => Promise.resolve(Object.assign(el, { on: vi.fn() }))),
      purge: vi.fn(),
      downloadImage: vi.fn(),
      Plots: { resize: vi.fn() },
    }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

// The fixtures are real engine output (ore body, projected clocks, 9 × 9 stations), so these tests also pin the wire contract.
describe('research parsers', () => {
  it('accepts the engine instrument comparison and keeps every case', () => {
    const c = parseInstrumentComparison(comparisonJson, 'comparison')
    expect(Object.keys(c.cases)).toEqual(['clock', 'gravimeter', 'joint'])
    expect(c.cases.joint.snr).toBeGreaterThanOrEqual(c.cases.gravimeter.snr)
  })

  it('rejects a clock sweep with missing values', () => {
    const broken = structuredClone(comparisonJson)
    broken.clock_sweep.clock_snr.pop()
    expect(() => parseInstrumentComparison(broken, 'comparison')).toThrow(ParseError)
  })

  it('accepts the engine benchmarks and rejects an inconsistent pass count', () => {
    expect(parseBenchmarks(benchmarksJson, 'benchmarks').passed).toBe(benchmarksJson.total)
    expect(() => parseBenchmarks({ ...benchmarksJson, passed: 0 }, 'benchmarks')).toThrow(ParseError)
  })
})

describe('instrument comparison section', () => {
  it('states which instrument dominates and lets the user switch the gravimeter', async () => {
    const comparison = parseInstrumentComparison(comparisonJson, 'comparison')
    const onChange = vi.fn()
    render(
      <ThemeProvider>
        <InstrumentComparisonSection state={{ status: 'done', comparison, key: 'k' }} gravimeter="relative" onGravimeterChange={onChange} />
      </ThemeProvider>,
    )
    expect(screen.getByText('The gravimeter dominates:')).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Clock + gravimeter' })).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Absolute gravimeter'))
    expect(onChange).toHaveBeenCalledWith('absolute')
    expect(document.body.textContent).not.toMatch(/\b(NaN|Infinity|undefined)\b/)
  })
})

describe('validation page', () => {
  it('shows every published benchmark with its DOI', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(benchmarksJson), { status: 200, headers: { 'Content-Type': 'application/json' } }))))
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Validation />
        </MemoryRouter>
      </ThemeProvider>,
    )
    expect(await screen.findByText(`${String(benchmarksJson.total)} of ${String(benchmarksJson.total)} checks agree`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'doi:10.1038/s41566-020-0619-8' })).toHaveAttribute('href', 'https://doi.org/10.1038/s41566-020-0619-8')
    expect(screen.queryByText('Disagrees')).not.toBeInTheDocument()
  })
})
