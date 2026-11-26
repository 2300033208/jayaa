/*
 * Runtime parsers for the instrument comparison and the published-result benchmarks. As everywhere,
 * nothing reaches the UI without passing through these.
 */

import type { Benchmark, BenchmarkRow, Benchmarks, CaseSummary, InstrumentComparison, MonteCarloCheck } from '../types/research'
import { GRAVIMETER_KINDS, INSTRUMENT_CASES } from '../types/research'
import type { Parser } from './parse'
import { array, boolean, finite, finiteArray, literal, matrix, nonNegativeInteger, nullable, object, record, refine, string } from './parse'
import { nonNegative, positive } from './schemas'

const correlation = refine(finite, (v) => (v >= -1 - 1e-9 && v <= 1 + 1e-9 ? null : 'expected a correlation in [-1, 1]'))

const monteCarlo: Parser<MonteCarloCheck> = object<MonteCarloCheck>({
  realizations: nonNegativeInteger,
  converged: nonNegativeInteger,
  mass_std_kg: nullable(nonNegative),
  depth_std_m: nullable(nonNegative),
  mass_bias_kg: nullable(finite),
  depth_bias_m: nullable(finite),
})

const caseSummary: Parser<CaseSummary> = object<CaseSummary>({
  snr: nonNegative,
  identifiable: boolean,
  std: object({ mass_kg: nullable(nonNegative), x_m: nullable(nonNegative), y_m: nullable(nonNegative), depth_m: nullable(nonNegative) }),
  relative_mass_uncertainty: nullable(nonNegative),
  relative_depth_uncertainty: nullable(nonNegative),
  mass_depth_correlation: nullable(correlation),
  mass_depth_covariance: nullable(matrix(2, 2)),
  monte_carlo: monteCarlo,
})

export const parseInstrumentComparison: Parser<InstrumentComparison> = refine(
  object<InstrumentComparison>({
    source: object({ body_id: string, mass_kg: finite, x_m: finite, y_m: finite, depth_m: positive, model: string }),
    station_count: nonNegativeInteger,
    profile: boolean,
    clock: object({ sigma: positive, unit: string, species: string, performance_class: string }),
    gravimeter: object({
      id: literal(GRAVIMETER_KINDS),
      label: string,
      relative: boolean,
      reading_sigma_m_s2: positive,
      sigma_m_s2: positive,
      station_height_term_m_s2: nonNegative,
      basis: string,
    }),
    cases: record(INSTRUMENT_CASES, caseSummary),
    depth_gain: nullable(nonNegative),
    clock_sweep: object({
      clock_sigma: finiteArray,
      clock_snr: finiteArray,
      clock_depth_std_m: array(nullable(nonNegative)),
      joint_depth_std_m: array(nullable(nonNegative)),
      joint_mass_std_kg: array(nullable(nonNegative)),
      depth_gain: array(nullable(nonNegative)),
      gravimeter_depth_std_m: nullable(nonNegative),
      gravimeter_snr: nonNegative,
      equal_snr_clock_sigma: nullable(positive),
      depth_gain_threshold: positive,
      depth_gain_clock_sigma: nullable(positive),
    }),
    depth_sweep: object({
      depths_m: finiteArray,
      clock_snr: finiteArray,
      gravimeter_snr: finiteArray,
      clock_to_gravimeter: array(nullable(nonNegative)),
      crossover_depth_m: nullable(positive),
    }),
    assumptions: string,
  }),
  (d) => {
    const s = d.clock_sweep
    const n = s.clock_sigma.length
    if (n === 0) return 'clock sweep must not be empty'
    if ([s.clock_snr, s.clock_depth_std_m, s.joint_depth_std_m, s.joint_mass_std_kg, s.depth_gain].some((a) => a.length !== n)) {
      return 'expected one value per clock accuracy'
    }
    if (s.clock_sigma.some((v) => v <= 0)) return 'clock accuracies must be positive'
    const p = d.depth_sweep
    const m = p.depths_m.length
    if (m === 0 || [p.clock_snr, p.gravimeter_snr, p.clock_to_gravimeter].some((a) => a.length !== m)) return 'expected one value per depth'
    if (p.depths_m.some((v) => v <= 0)) return 'depths must be positive'
    return null
  },
)

const benchmarkRow: Parser<BenchmarkRow> = object<BenchmarkRow>({
  quantity: string,
  unit: string,
  engine: finite,
  published: finite,
  published_sigma: nullable(positive),
  difference: finite,
  relative_difference: nullable(finite),
  z: nullable(finite),
  criterion: string,
  passed: boolean,
  note: string,
})

const benchmark: Parser<Benchmark> = object<Benchmark>({
  id: string,
  title: string,
  citation: string,
  doi: refine(string, (v) => (/^10\.\d{4,9}\/\S+$/.test(v) ? null : 'expected a DOI')),
  what_is_checked: string,
  rows: array(benchmarkRow),
})

export const parseBenchmarks: Parser<Benchmarks> = refine(
  object<Benchmarks>({ benchmarks: array(benchmark), passed: nonNegativeInteger, total: nonNegativeInteger, method: string }),
  (b) => {
    const rows = b.benchmarks.flatMap((item) => item.rows)
    if (rows.length !== b.total) return 'total must count every row'
    if (rows.filter((r) => r.passed).length !== b.passed) return 'passed must count the passing rows'
    return null
  },
)
