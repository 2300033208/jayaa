import type { RouteObject } from 'react-router'
import { AppShell } from '../components/layout/AppShell'
import { RouteFallback } from '../components/layout/RouteFallback'
import { SessionGate } from '../components/layout/SessionGate'

/** Pages are code-split with the router's native lazy loading. Everything but sign-in needs a session. */
export const routes: RouteObject[] = [
  { path: 'sign-in', HydrateFallback: RouteFallback, lazy: async () => ({ Component: (await import('../pages/SignIn')).default }) },
  {
    element: <SessionGate />,
    HydrateFallback: RouteFallback,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, lazy: async () => ({ Component: (await import('../pages/Home')).default }) },
          { path: 'experiments/new', lazy: async () => ({ Component: (await import('../pages/Experiment')).default }) },
          { path: 'experiments/:experimentId', lazy: async () => ({ Component: (await import('../pages/Experiment')).default }) },
          { path: 'experiments/:experimentId/simulation', lazy: async () => ({ Component: (await import('../pages/Simulation')).default }) },
          { path: 'experiments/:experimentId/analysis', lazy: async () => ({ Component: (await import('../pages/Analysis')).default }) },
          { path: 'experiments/:experimentId/study', lazy: async () => ({ Component: (await import('../pages/Study')).default }) },
          { path: 'experiments/:experimentId/field-data', lazy: async () => ({ Component: (await import('../pages/FieldData')).default }) },
          { path: 'study', lazy: async () => ({ Component: (await import('../pages/Study')).default }) },
          { path: 'field-data', lazy: async () => ({ Component: (await import('../pages/FieldData')).default }) },
          { path: 'terrain', lazy: async () => ({ Component: (await import('../pages/Terrain')).default }) },
          { path: 'compare', lazy: async () => ({ Component: (await import('../pages/Compare')).default }) },
          { path: 'simulation', lazy: async () => ({ Component: (await import('../pages/Simulation')).default }) },
          { path: 'analysis', lazy: async () => ({ Component: (await import('../pages/Analysis')).default }) },
          { path: 'validation', lazy: async () => ({ Component: (await import('../pages/Validation')).default }) },
          { path: 'history', lazy: async () => ({ Component: (await import('../pages/ExperimentHistory')).default }) },
          { path: 'account', lazy: async () => ({ Component: (await import('../pages/Account')).default }) },
          { path: '*', lazy: async () => ({ Component: (await import('../pages/NotFound')).default }) },
        ],
      },
    ],
  },
]
