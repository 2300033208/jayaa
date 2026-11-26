import type { FieldMessage } from '../types/api'

export type ApiErrorKind = 'network' | 'timeout' | 'aborted' | 'http' | 'parse'

export const ENGINE_UNAVAILABLE = 'Simulation engine unavailable. Check the backend connection and try again.'

/** A user-facing error with enough structure to render a precise message. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly code: string
  readonly fields: FieldMessage[]
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: {
      status?: number | null
      code?: string
      fields?: FieldMessage[]
      details?: Record<string, unknown>
    } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = options.status ?? null
    this.code = options.code ?? kind
    this.fields = options.fields ?? []
    this.details = options.details ?? {}
  }

  get engineUnavailable(): boolean {
    return this.kind === 'network' || this.status === 502 || this.status === 503 || this.status === 504
  }

  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.status === 502 || this.status === 503 || this.status === 504
  }
}

/** Message for an HTTP status when the engine did not supply a more specific one. */
export function messageForStatus(status: number, engineMessage: string | null): string {
  switch (status) {
    case 400:
      return engineMessage ?? 'The request was malformed.'
    case 401:
      return 'Your session has expired or you are not signed in. Sign in again to continue.'
    case 403:
      return 'You do not have permission to perform this action.'
    case 404:
      return engineMessage ?? 'The requested item was not found. It may have been deleted.'
    case 409:
      return engineMessage ?? 'The request conflicts with the current state. Reload and try again.'
    case 422:
      return engineMessage ?? 'Some values are invalid.'
    case 429:
      return 'Too many requests. Wait a moment and try again.'
    case 500:
      return engineMessage ? `The simulation engine reported an internal error: ${engineMessage}` : 'The simulation engine reported an internal error.'
    case 502:
    case 503:
    case 504:
      return ENGINE_UNAVAILABLE
    default:
      return engineMessage ?? `Unexpected response from the simulation engine (HTTP ${status}).`
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof Error) return new ApiError('network', error.message)
  return new ApiError('network', 'Unknown error')
}

export function isAbort(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'aborted'
}
