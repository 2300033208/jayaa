/** Wire types for the instrument comparison and the published-result benchmarks. */

export const INSTRUMENT_CASES = ['clock', 'gravimeter', 'joint'] as const
export type InstrumentCase = (typeof INSTRUMENT_CASES)[number]

export const GRAVIMETER_KINDS = ['relative', 'absolute'] as const
export type GravimeterKind = (typeof GRAVIMETER_KINDS)[number]

export interface MonteCarloCheck {
  realizations: number
  converged: number
  mass_std_kg: number | null
  depth_std_m: number | null
  mass_bias_kg: number | null
  depth_bias_m: number | null
}

export interface CaseSummary {
  snr: number
  identifiable: boolean
  std: { mass_kg: number | null; x_m: number | null; y_m: number | null; depth_m: number | null }
  relative_mass_uncertainty: number | null
  relative_depth_uncertainty: number | null
  mass_depth_correlation: number | null
  mass_depth_covariance: number[][] | null
  monte_carlo: MonteCarloCheck
}

export interface InstrumentComparison {
  source: { body_id: string; mass_kg: number; x_m: number; y_m: number; depth_m: number; model: string }
  station_count: number
  profile: boolean
  clock: { sigma: number; unit: string; species: string; performance_class: string }
  gravimeter: {
    id: GravimeterKind
    label: string
    relative: boolean
    reading_sigma_m_s2: number
    sigma_m_s2: number
    station_height_term_m_s2: number
    basis: string
  }
  cases: Record<InstrumentCase, CaseSummary>
  depth_gain: number | null
  clock_sweep: {
    clock_sigma: number[]
    clock_snr: number[]
    clock_depth_std_m: (number | null)[]
    joint_depth_std_m: (number | null)[]
    joint_mass_std_kg: (number | null)[]
    depth_gain: (number | null)[]
    gravimeter_depth_std_m: number | null
    gravimeter_snr: number
    equal_snr_clock_sigma: number | null
    depth_gain_threshold: number
    depth_gain_clock_sigma: number | null
  }
  depth_sweep: {
    depths_m: number[]
    clock_snr: number[]
    gravimeter_snr: number[]
    clock_to_gravimeter: (number | null)[]
    crossover_depth_m: number | null
  }
  assumptions: string
}

export interface BenchmarkRow {
  quantity: string
  unit: string
  engine: number
  published: number
  published_sigma: number | null
  difference: number
  relative_difference: number | null
  z: number | null
  criterion: string
  passed: boolean
  note: string
}

export interface Benchmark {
  id: string
  title: string
  citation: string
  doi: string
  what_is_checked: string
  rows: BenchmarkRow[]
}

export interface Benchmarks {
  benchmarks: Benchmark[]
  passed: number
  total: number
  method: string
}
