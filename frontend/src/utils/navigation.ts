/** Only paths inside this application are followed after signing in (no open redirects). */
export function safeNext(value: string | null): string {
  if (value === null || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.startsWith('/sign-in')) return '/'
  return value
}
