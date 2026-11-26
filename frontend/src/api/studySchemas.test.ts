import { describe, expect, it } from 'vitest'
import { EXP_ID, HASH } from '../test/fixtures'
import { designJson, repeatStudyJson, sweepStudyJson } from '../test/studyFixtures'
import { ParseError } from './parse'
import { parseDesign, parseStudy, parseStudyList } from './studySchemas'

describe('study responses', () => {
  it('accepts completed repeat and sweep studies', () => {
    const repeat = parseStudy(repeatStudyJson(), 'study')
    expect(repeat.result?.kind).toBe('repeat')
    expect(repeat.experiment_id).toBe(EXP_ID)
    expect(repeat.configuration_hash).toBe(HASH)
    const sweep = parseStudy(sweepStudyJson(), 'study')
    expect(sweep.result?.kind).toBe('sweep')
  })

  it('accepts listings without results', () => {
    const summary: Record<string, unknown> = { ...repeatStudyJson() }
    delete summary.result
    expect(parseStudyList({ items: [summary] }, 'list')[0]?.result).toBeNull()
  })

  it('rejects inconsistent studies', () => {
    expect(() => parseStudy({ ...repeatStudyJson(), kind: 'sweep' }, 'study')).toThrow(/result kind does not match/)
    expect(() => parseStudy({ ...repeatStudyJson(), status: 'failed', result: null }, 'study')).toThrow(/must carry its error/)
    expect(() => parseStudy({ ...repeatStudyJson(), progress: 0.5 }, 'study')).toThrow(/completed study must be at 100 %/)
    const badRate = repeatStudyJson()
    badRate.result.detection = { k: 11, n: 10, rate: 1, low: 0.7, high: 1 }
    expect(() => parseStudy(badRate, 'study')).toThrow(/successes exceed trials/)
    const ragged = sweepStudyJson()
    ragged.result.detection = [ragged.result.detection[0] ?? []]
    expect(() => parseStudy(ragged, 'study')).toThrow(/one row per depth/)
    expect(() => parseStudy({ ...repeatStudyJson(), result: { kind: 'mystery' } }, 'study')).toThrow(ParseError)
  })

  it('checks that a design recommendation matches its verdict', () => {
    expect(parseDesign(designJson(), 'design').recommended?.stations).toBe(81)
    expect(() => parseDesign({ ...designJson(), recommended: null }, 'design')).toThrow(/recommendation must exist/)
    expect(() => parseDesign({ ...designJson(), verdict: 'none_within_budget' }, 'design')).toThrow(/recommendation must exist/)
  })
})
