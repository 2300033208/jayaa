import { useEffect, useRef, useState } from 'react'

/** Returns `value`, updated at most once per `intervalMs` (trailing update guaranteed). */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value)
  const last = useRef(0)

  useEffect(() => {
    const wait = Math.max(0, intervalMs - (performance.now() - last.current))
    const timer = globalThis.setTimeout(() => {
      last.current = performance.now()
      setThrottled(value)
    }, wait)
    return () => {
      globalThis.clearTimeout(timer)
    }
  }, [value, intervalMs])

  return throttled
}
