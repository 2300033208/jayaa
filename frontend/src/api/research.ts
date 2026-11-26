import type { ExperimentConfig } from '../types/config'
import type { Benchmarks, GravimeterKind, InstrumentComparison } from '../types/research'
import { request } from './client'
import { parseBenchmarks, parseInstrumentComparison } from './researchSchemas'

export function getInstrumentComparison(
  config: ExperimentConfig,
  gravimeter: GravimeterKind,
  signal?: AbortSignal,
): Promise<InstrumentComparison> {
  return request('/api/experiments/instruments', parseInstrumentComparison, {
    method: 'POST',
    body: { config, gravimeter },
    signal,
    retries: 1,
  })
}

export function getBenchmarks(signal?: AbortSignal): Promise<Benchmarks> {
  return request('/api/benchmarks', parseBenchmarks, { signal, retries: 1 })
}
