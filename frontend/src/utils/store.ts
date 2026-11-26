import { useCallback, useSyncExternalStore } from 'react'

export interface Store<T> {
  getState: () => T
  setState: (patch: Partial<T> | ((state: T) => Partial<T>)) => void
  subscribe: (listener: () => void) => () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    setState(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch
      let changed = false
      for (const key of Object.keys(next) as (keyof T)[]) {
        if (!Object.is(state[key], next[key])) {
          changed = true
          break
        }
      }
      if (!changed) return
      state = { ...state, ...next }
      listeners.forEach((listener) => {
        listener()
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Subscribes to one slice. The selector must return a stable value (primitive or stored reference). */
export function useStore<T, S>(store: Store<T>, selector: (state: T) => S): S {
  const getSnapshot = useCallback(() => selector(store.getState()), [store, selector])
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}
