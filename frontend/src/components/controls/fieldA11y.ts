import type { ReactNode } from 'react'

export interface FieldMessages {
  error?: string | null | undefined
  warning?: string | null | undefined
  hint?: ReactNode
}

/** ids of the message elements that describe a field, for aria-describedby. */
export function describedBy(id: string, messages: FieldMessages): string | undefined {
  const ids = [messages.error ? `${id}-error` : null, messages.warning ? `${id}-warning` : null, messages.hint ? `${id}-hint` : null]
  const joined = ids.filter((v): v is string => v !== null).join(' ')
  return joined === '' ? undefined : joined
}
