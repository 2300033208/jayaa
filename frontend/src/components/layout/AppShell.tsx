import { Activity, BadgeCheck, Dices, FileSpreadsheet, FlaskConical, GitCompare, History, LineChart, Monitor, Moon, Mountain, Sun, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { Suspense, useCallback, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useMatch } from 'react-router'
import type { ActiveExperiment } from '../../app/providers/shellContext'
import { useUser } from '../../app/providers/sessionContext'
import { ShellContext, lastExperimentId } from '../../app/providers/shellContext'
import { useTheme } from '../../app/providers/themeContext'
import type { ThemePreference } from '../../app/providers/themeContext'
import { useEngineHealth } from '../../hooks/useEngineHealth'
import { cx } from '../../utils/misc'
import { ErrorBoundary } from '../feedback/ErrorBoundary'
import { Skeleton } from '../feedback/States'
import styles from './layout.module.css'

const THEME_CYCLE: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' }

function ThemeButton() {
  const { preference, setPreference } = useTheme()
  const Icon = preference === 'system' ? Monitor : preference === 'light' ? Sun : Moon
  const label = preference === 'system' ? 'System theme' : preference === 'light' ? 'Light theme' : 'Dark theme'
  return (
    <button
      type="button"
      className={styles.iconButton}
      onClick={() => {
        setPreference(THEME_CYCLE[preference])
      }}
      aria-label={`${label}. Switch theme`}
      title={`${label} (click to switch)`}
    >
      <Icon aria-hidden="true" />
    </button>
  )
}

function EngineStatus() {
  const health = useEngineHealth()
  const text = health.state === 'online' ? 'Engine online' : health.state === 'offline' ? 'Engine unavailable' : 'Checking engine…'
  return (
    <span className={styles.engine} data-state={health.state} role="status" title={health.state === 'online' ? `Engine ${health.version}` : text}>
      <span className={styles.engineDot} aria-hidden="true" />
      <span className={styles.engineText}>{text}</span>
    </span>
  )
}

function AccountLink() {
  const user = useUser()
  return (
    <NavLink to="/account" className={({ isActive }) => cx(styles.account, isActive && styles.accountActive)} title={`Signed in as ${user.email}`}>
      <UserRound aria-hidden="true" />
      <span className={styles.accountName}>{user.display_name}</span>
    </NavLink>
  )
}

interface NavItem {
  label: string
  to: string
  icon: ReactNode
  end?: boolean
}

export function AppShell() {
  const [active, setActiveState] = useState<ActiveExperiment | null>(null)
  const setActive = useCallback((next: ActiveExperiment | null) => {
    setActiveState((prev) =>
      prev?.id === next?.id && prev?.code === next?.code && prev?.name === next?.name ? prev : next,
    )
  }, [])
  const shell = useMemo(() => ({ active, setActive }), [active, setActive])

  const match = useMatch('/experiments/:experimentId/*')
  const routeId = match?.params.experimentId
  const experimentId = routeId !== undefined && routeId !== 'new' ? routeId : (active?.id ?? lastExperimentId())
  const code = active !== null && active.id === experimentId ? active.code : null

  const items: NavItem[] = [
    { label: 'Experiment', to: experimentId ? `/experiments/${experimentId}` : '/experiments/new', icon: <FlaskConical aria-hidden="true" />, end: true },
    { label: 'Simulation', to: experimentId ? `/experiments/${experimentId}/simulation` : '/simulation', icon: <Activity aria-hidden="true" /> },
    { label: 'Analysis', to: experimentId ? `/experiments/${experimentId}/analysis` : '/analysis', icon: <LineChart aria-hidden="true" /> },
    { label: 'Study', to: experimentId ? `/experiments/${experimentId}/study` : '/study', icon: <Dices aria-hidden="true" /> },
    { label: 'Field data', to: experimentId ? `/experiments/${experimentId}/field-data` : '/field-data', icon: <FileSpreadsheet aria-hidden="true" /> },
    { label: 'Compare', to: '/compare', icon: <GitCompare aria-hidden="true" /> },
    { label: 'Terrain', to: '/terrain', icon: <Mountain aria-hidden="true" /> },
    { label: 'Validation', to: '/validation', icon: <BadgeCheck aria-hidden="true" /> },
    { label: 'History', to: '/history', icon: <History aria-hidden="true" /> },
  ]

  return (
    <ShellContext.Provider value={shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <Link to="/" className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true" />
            <span>Atomic Gravity Simulator</span>
          </Link>
          <div className={styles.topbarRight}>
            {code && (
              <span className={styles.expCode} title={active?.name}>
                {code}
              </span>
            )}
            <EngineStatus />
            <ThemeButton />
            <AccountLink />
          </div>
        </header>
        <nav className={styles.sidebar} aria-label="Primary">
          <ul>
            {items.map((item) => (
              <li key={item.label}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => cx(styles.navLink, isActive && styles.navActive)}>
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" className={styles.main} tabIndex={-1}>
          <ErrorBoundary region="Page">
            <Suspense fallback={<Skeleton height={320} label="Loading page" />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </ShellContext.Provider>
  )
}
