import type { ReactNode } from 'react'
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { oneOf, readStored, writeStored } from '../../utils/storage'
import type { ResolvedTheme, ThemePreference, ThemeTokens } from './themeContext'
import { ThemeContext, readTokens } from './themeContext'

const PREFERENCES = ['system', 'light', 'dark'] as const
const QUERY = '(prefers-color-scheme: dark)'

function subscribeSystem(callback: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', callback)
  return () => {
    media.removeEventListener('change', callback)
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
}

/** Writes the theme attribute on <html>; called before render so CSS tokens are current. */
function applyPreference(preference: ThemePreference): void {
  const root = document.documentElement
  if (preference === 'system') delete root.dataset.theme
  else root.dataset.theme = preference
}

const tokenCache = new Map<ResolvedTheme, ThemeTokens>()

function tokensFor(theme: ResolvedTheme): ThemeTokens {
  const cached = tokenCache.get(theme)
  if (cached) return cached
  const tokens = readTokens()
  tokenCache.set(theme, tokens)
  return tokens
}

function initialPreference(): ThemePreference {
  const stored = readStored('theme', oneOf(PREFERENCES)) ?? 'system'
  applyPreference(stored)
  return stored
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference)
  const systemDark = useSyncExternalStore(subscribeSystem, systemPrefersDark, () => false)
  const resolved: ResolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  const setPreference = useCallback((next: ThemePreference) => {
    applyPreference(next)
    writeStored('theme', next)
    setPreferenceState(next)
  }, [])

  // The attribute is applied before render, so computed tokens match the resolved theme.
  const tokens = useMemo(() => tokensFor(resolved), [resolved])

  const value = useMemo(() => ({ preference, resolved, tokens, setPreference }), [preference, resolved, tokens, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
