import { LogIn, UserPlus } from 'lucide-react'
import type { SyntheticEvent } from 'react'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { getAuthConfig, register, signIn } from '../api/account'
import { ApiError } from '../api/errors'
import { useSession } from '../app/providers/sessionContext'
import { Button } from '../components/controls/Button'
import { Segmented } from '../components/controls/Choice'
import { TextField } from '../components/controls/TextField'
import { Banner } from '../components/feedback/States'
import styles from '../features/account/account.module.css'
import type { AuthConfig } from '../types/field'
import { safeNext } from '../utils/navigation'
import { userError } from '../utils/userError'

type Mode = 'sign_in' | 'register'

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+$/

function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {}
  return Object.fromEntries(error.fields.map((f) => [f.field, f.message]))
}

export default function SignIn() {
  const { state, signedIn } = useSession()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = safeNext(params.get('next'))
  const expired = params.get('reason') === 'expired'

  const [mode, setMode] = useState<Mode>('sign_in')
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const controller = new AbortController()
    getAuthConfig(controller.signal)
      .then(setConfig)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setConfigError(userError(err, 'Could not reach the engine').message)
      })
    return () => {
      controller.abort()
    }
  }, [])

  if (state.status === 'signed_in') return <Navigate to={next} replace />

  const minLength = config?.password_min_length ?? 12

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {}
    const trimmed = email.trim()
    if (trimmed === '') found.email = 'Email is required.'
    else if (!EMAIL_RE.test(trimmed)) found.email = 'Enter a valid email address.'
    if (mode === 'register') {
      if (name.trim() === '') found.display_name = 'Name is required.'
      if (password.length < minLength) found.password = `Password must be at least ${minLength} characters.`
      else if (confirm !== password) found.confirm = 'The passwords do not match.'
    } else if (password === '') {
      found.password = 'Password is required.'
    }
    return found
  }

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault()
    const found = validate()
    setErrors(found)
    setError(null)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      const user = mode === 'sign_in' ? await signIn(email.trim(), password) : await register(email.trim(), name.trim(), password)
      signedIn(user)
      void navigate(next, { replace: true })
    } catch (err) {
      setErrors(fieldErrors(err))
      setError(userError(err, mode === 'sign_in' ? 'Sign-in failed' : 'Could not create the account').message)
      setPassword('')
      setConfirm('')
    } finally {
      setBusy(false)
    }
  }

  const signupAllowed = config?.signup_allowed === true
  return (
    <div className={styles.screen}>
      <main className={styles.card} aria-labelledby="sign-in-heading">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          <span>Atomic Gravity Simulator</span>
        </div>
        <h1 id="sign-in-heading" className={styles.title}>
          {mode === 'sign_in' ? 'Sign in' : 'Create an account'}
        </h1>
        <p className={styles.lead}>Experiments, field data and elevation models are private to your account.</p>
        {expired && mode === 'sign_in' && (
          <Banner tone="warning" title="Your session has expired">
            Sign in again to continue where you left off.
          </Banner>
        )}
        {configError !== null && (
          <Banner tone="critical" title="Simulation engine unavailable">
            {configError}
          </Banner>
        )}
        {signupAllowed && (
          <Segmented<Mode>
            name="account-mode"
            ariaLabel="Account"
            value={mode}
            options={[
              { value: 'sign_in', label: 'Sign in' },
              { value: 'register', label: 'Create account' },
            ]}
            onChange={(value) => {
              setMode(value)
              setErrors({})
              setError(null)
            }}
          />
        )}
        <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
          <TextField id="account-email" label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} maxLength={254} error={errors.email} />
          {mode === 'register' && (
            <TextField id="account-name" label="Name" autoComplete="name" value={name} onChange={setName} maxLength={80} error={errors.display_name} />
          )}
          <TextField
            id="account-password"
            label="Password"
            type="password"
            autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={setPassword}
            maxLength={256}
            error={errors.password}
            hint={mode === 'register' ? `At least ${minLength} characters; a phrase of several words is easiest to remember.` : undefined}
          />
          {mode === 'register' && (
            <TextField id="account-confirm" label="Repeat password" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} maxLength={256} error={errors.confirm} />
          )}
          {error !== null && (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" busy={busy} icon={mode === 'sign_in' ? <LogIn aria-hidden="true" /> : <UserPlus aria-hidden="true" />}>
            {mode === 'sign_in' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        {config !== null && !signupAllowed && (
          <p className={styles.note}>New accounts on this server are created by the administrator.</p>
        )}
      </main>
    </div>
  )
}
