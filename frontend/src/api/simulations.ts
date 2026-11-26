import type { MeasurementPage, SimulationStatusDoc, SurveyPlan } from '../types/api'
import type { Playback } from '../types/config'
import { request } from './client'
import type { Parser } from './parse'
import { parseMeasurementPage, parsePlan, parseSimulationList, parseSimulationStatus } from './schemas'

const enc = encodeURIComponent

export function startSimulation(
  experimentId: string,
  options: { playback: Playback; expectedConfigurationHash: string; idempotencyKey: string },
  signal?: AbortSignal,
): Promise<SimulationStatusDoc> {
  return request(`/api/experiments/${enc(experimentId)}/simulations`, parseSimulationStatus, {
    method: 'POST',
    body: { playback: options.playback, expected_configuration_hash: options.expectedConfigurationHash },
    idempotencyKey: options.idempotencyKey,
    signal,
  })
}

export function listSimulations(experimentId: string, signal?: AbortSignal): Promise<SimulationStatusDoc[]> {
  return request(`/api/experiments/${enc(experimentId)}/simulations`, parseSimulationList, { signal })
}

export function getSimulationStatus(id: string, signal?: AbortSignal): Promise<SimulationStatusDoc> {
  return request(`/api/simulations/${enc(id)}`, parseSimulationStatus, { signal })
}

export function pauseSimulation(id: string, signal?: AbortSignal): Promise<SimulationStatusDoc> {
  return request(`/api/simulations/${enc(id)}/pause`, parseSimulationStatus, { method: 'POST', signal, retries: 1 })
}

export function resumeSimulation(id: string, signal?: AbortSignal): Promise<SimulationStatusDoc> {
  return request(`/api/simulations/${enc(id)}/resume`, parseSimulationStatus, { method: 'POST', signal, retries: 1 })
}

export function cancelSimulation(id: string, signal?: AbortSignal): Promise<SimulationStatusDoc> {
  return request(`/api/simulations/${enc(id)}/cancel`, parseSimulationStatus, { method: 'POST', signal, retries: 1 })
}

export function getSurveyPlan(id: string, signal?: AbortSignal): Promise<SurveyPlan> {
  return request(`/api/simulations/${enc(id)}/plan`, parsePlan, { signal, timeoutMs: 30_000 })
}

const measurementPage: Parser<MeasurementPage> = (value, path) => parseMeasurementPage(value, path)

export function getMeasurements(id: string, afterIndex: number, signal?: AbortSignal): Promise<MeasurementPage> {
  return request(`/api/simulations/${enc(id)}/measurements?after_index=${afterIndex}`, measurementPage, {
    signal,
    timeoutMs: 60_000,
  })
}
