import type { Defaults, DetectabilityStudy, Experiment, ExperimentSummary, SurveyPlan, ValidationResult } from '../types/api'
import type { ExperimentConfig } from '../types/config'
import { noContent, request } from './client'
import { object, string } from './parse'
import { parseDefaults, parseDetectability, parseExperiment, parseExperimentList, parsePlan, parseValidation } from './schemas'

const enc = encodeURIComponent

export function checkHealth(signal?: AbortSignal): Promise<{ status: string; engine_version: string }> {
  return request('/api/health', object({ status: string, engine_version: string }), {
    signal,
    timeoutMs: 4000,
    retries: 0,
  })
}

export function getDefaults(signal?: AbortSignal): Promise<Defaults> {
  return request('/api/defaults', parseDefaults, { signal })
}

export function validateExperiment(config: ExperimentConfig, signal?: AbortSignal): Promise<ValidationResult> {
  return request('/api/experiments/validate', parseValidation, { method: 'POST', body: { config }, signal, retries: 1 })
}

/** Expected detection significance over mass and depth for this site, survey and clock (engine-computed). */
export function getDetectability(config: ExperimentConfig, signal?: AbortSignal): Promise<DetectabilityStudy> {
  return request('/api/experiments/detectability', parseDetectability, { method: 'POST', body: { config }, signal, retries: 1 })
}

export function createExperiment(config: ExperimentConfig, signal?: AbortSignal): Promise<Experiment> {
  return request('/api/experiments', parseExperiment, { method: 'POST', body: { config }, signal })
}

export function updateExperiment(
  id: string,
  config: ExperimentConfig,
  expectedVersion: number,
  signal?: AbortSignal,
): Promise<Experiment> {
  return request(`/api/experiments/${enc(id)}`, parseExperiment, {
    method: 'PUT',
    body: { config, expected_version: expectedVersion },
    signal,
  })
}

export function getExperiment(id: string, signal?: AbortSignal): Promise<Experiment> {
  return request(`/api/experiments/${enc(id)}`, parseExperiment, { signal })
}

export function listExperiments(limit: number, signal?: AbortSignal): Promise<ExperimentSummary[]> {
  return request(`/api/experiments?limit=${limit}`, parseExperimentList, { signal })
}

export function deleteExperiment(id: string, signal?: AbortSignal): Promise<null> {
  return request(`/api/experiments/${enc(id)}`, noContent, { method: 'DELETE', signal })
}

export function getPlanPreview(id: string, signal?: AbortSignal): Promise<SurveyPlan> {
  return request(`/api/experiments/${enc(id)}/plan`, parsePlan, { signal, timeoutMs: 30_000 })
}
