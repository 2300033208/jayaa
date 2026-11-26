import { createContext, useContext } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/** Resolved design tokens for canvas-based renderers (Plotly, Three.js) that cannot read CSS. */
export interface ThemeTokens {
  surface: string
  page: string
  ink: string
  ink2: string
  ink3: string
  inkAxis: string
  line: string
  lineStrong: string
  accent: string
  series1: string
  series2: string
  series3: string
  truth: string
  good: string
  warning: string
  critical: string
  diverging: string[]
  sceneBg: string
  sceneSurface: string
  sceneVolume: string
  sceneDense: string
  sceneCavity: string
  sceneSensor: string
  scenePath: string
  sceneEstimate: string
  fontSans: string
  fontMono: string
}

export interface ThemeContextValue {
  preference: ThemePreference
  resolved: ResolvedTheme
  tokens: ThemeTokens
  setPreference: (preference: ThemePreference) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (value === null) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}

const FALLBACK = '#808080'

export function readTokens(): ThemeTokens {
  const style = getComputedStyle(document.documentElement)
  const get = (name: string) => {
    const value = style.getPropertyValue(name).trim()
    return value === '' ? FALLBACK : value
  }
  return {
    surface: get('--surface'),
    page: get('--page'),
    ink: get('--ink'),
    ink2: get('--ink-2'),
    ink3: get('--ink-3'),
    inkAxis: get('--ink-axis'),
    line: get('--line'),
    lineStrong: get('--line-strong'),
    accent: get('--accent'),
    series1: get('--series-1'),
    series2: get('--series-2'),
    series3: get('--series-3'),
    truth: get('--truth'),
    good: get('--good'),
    warning: get('--warning'),
    critical: get('--critical'),
    diverging: Array.from({ length: 9 }, (_, i) => get(`--div-${i}`)),
    sceneBg: get('--scene-bg'),
    sceneSurface: get('--scene-surface'),
    sceneVolume: get('--scene-volume'),
    sceneDense: get('--scene-dense'),
    sceneCavity: get('--scene-cavity'),
    sceneSensor: get('--scene-sensor'),
    scenePath: get('--scene-path'),
    sceneEstimate: get('--scene-estimate'),
    fontSans: get('--font-sans'),
    fontMono: get('--font-mono'),
  }
}
