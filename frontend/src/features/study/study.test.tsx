import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseStudy } from '../../api/studySchemas'
import { ThemeProvider } from '../../app/providers/ThemeProvider'
import { repeatStudyJson, sweepStudyJson } from '../../test/studyFixtures'
import { RepeatView, SweepView } from './StudyResults'

describe('study results', () => {
  it('shows the detection rate with its interval and the coverage of the intervals', () => {
    const study = parseStudy(repeatStudyJson(), 'study')
    if (study.result?.kind !== 'repeat') throw new Error('expected a repeat result')
    render(
      <ThemeProvider>
        <RepeatView result={study.result} exportName="t" />
      </ThemeProvider>,
    )
    expect(screen.getAllByText(/90\.0 %/).length).toBeGreaterThan(0)
    expect(document.body.textContent).toMatch(/9\/10; 95 % interval 60\.0 %–98\.0 %/)
    const table = screen.getByRole('table')
    expect(table.textContent).toMatch(/Depth/)
    expect(table.textContent).toMatch(/8\/10/) // truth inside the depth interval in 8 of 10 runs
    expect(document.body.textContent).not.toMatch(/NaN/)
  })

  it('renders the sweep with every cell, including the ones not simulated', () => {
    const study = parseStudy(sweepStudyJson(), 'study')
    if (study.result?.kind !== 'sweep') throw new Error('expected a sweep result')
    render(
      <ThemeProvider>
        <SweepView result={study.result} exportName="t" />
      </ThemeProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Detection probability over mass and depth' })).toBeInTheDocument()
    expect(document.body.textContent).toMatch(/left empty/)
  })
})
