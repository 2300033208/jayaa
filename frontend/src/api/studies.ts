import type { ExperimentConfig } from '../types/config'
import type { DesignResult, Study, StudyRequest } from '../types/studies'
import { request } from './client'
import { parseDesign, parseStudy, parseStudyList } from './studySchemas'

const enc = encodeURIComponent

export function startStudy(experimentId: string, body: StudyRequest, signal?: AbortSignal): Promise<Study> {
  return request(`/api/experiments/${enc(experimentId)}/studies`, parseStudy, { method: 'POST', body, signal })
}

export function listStudies(experimentId: string, signal?: AbortSignal): Promise<Study[]> {
  return request(`/api/experiments/${enc(experimentId)}/studies`, parseStudyList, { signal })
}

export function getStudy(studyId: string, signal?: AbortSignal): Promise<Study> {
  return request(`/api/studies/${enc(studyId)}`, parseStudy, { signal })
}

export function cancelStudy(studyId: string, signal?: AbortSignal): Promise<Study> {
  return request(`/api/studies/${enc(studyId)}/cancel`, parseStudy, { method: 'POST', signal })
}

/** Station spacing and averaging time that detect a target within a fieldwork budget (engine-computed). */
export function designSurvey(
  config: ExperimentConfig,
  target: { mass_kg: number; depth_m: number; max_days: number },
  signal?: AbortSignal,
): Promise<DesignResult> {
  return request('/api/experiments/design', parseDesign, {
    method: 'POST',
    body: { config, target_mass_kg: target.mass_kg, target_depth_m: target.depth_m, max_days: target.max_days },
    signal,
    retries: 1,
  })
}
