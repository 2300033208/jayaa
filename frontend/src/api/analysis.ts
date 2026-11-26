import type { AnomalyMapDoc, InversionDoc, ResultSection, Results, SignalsDoc, UncertaintyDoc } from '../types/api'
import { apiUrl, request } from './client'
import { parseAnomalyMap, parseInversion, parseResults, parseSignals, parseUncertainty } from './schemas'

const enc = encodeURIComponent
const HEAVY = { timeoutMs: 60_000 }

export function getSimulationResults(id: string, signal?: AbortSignal): Promise<Results> {
  return request(`/api/simulations/${enc(id)}/results`, parseResults, { signal })
}

export function getSignalData(id: string, signal?: AbortSignal): Promise<ResultSection<SignalsDoc>> {
  return request(`/api/simulations/${enc(id)}/results/signals`, parseSignals, { signal, ...HEAVY })
}

export function getAnomalyMap(id: string, signal?: AbortSignal): Promise<ResultSection<AnomalyMapDoc>> {
  return request(`/api/simulations/${enc(id)}/results/anomaly-map`, parseAnomalyMap, { signal, ...HEAVY })
}

export function getInversionResult(id: string, signal?: AbortSignal): Promise<ResultSection<InversionDoc>> {
  return request(`/api/simulations/${enc(id)}/results/inversion`, parseInversion, { signal })
}

export function getUncertainty(id: string, signal?: AbortSignal): Promise<ResultSection<UncertaintyDoc>> {
  return request(`/api/simulations/${enc(id)}/results/uncertainty`, parseUncertainty, { signal })
}

/** Large datasets are exported by the engine and downloaded directly (no client-side assembly). */
export function exportUrl(id: string, format: 'csv' | 'json'): string {
  return apiUrl(`/api/simulations/${enc(id)}/export?format=${format}`)
}

export function reportUrl(id: string): string {
  return apiUrl(`/api/simulations/${enc(id)}/report`)
}
