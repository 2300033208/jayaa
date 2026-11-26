import { Skeleton } from '../feedback/States'

/** Shown while the first route module loads. */
export function RouteFallback() {
  return <Skeleton height="60vh" label="Loading application" />
}
