import { ApiError, ENGINE_UNAVAILABLE, toApiError } from '../api/errors'
import type { FieldMessage } from '../types/api'

export interface UserError {
  title: string
  message: string
  code: string
  retryable: boolean
  engineUnavailable: boolean
  fields: FieldMessage[]
}

export function userError(error: unknown, title: string): UserError {
  const api = error instanceof ApiError ? error : toApiError(error)
  const engineUnavailable = api.engineUnavailable
  return {
    title: engineUnavailable ? 'Simulation engine unavailable' : title,
    message: engineUnavailable ? ENGINE_UNAVAILABLE : api.message,
    code: api.code,
    retryable: api.retryable || api.kind === 'parse',
    engineUnavailable,
    fields: api.fields,
  }
}
