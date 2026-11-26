import { KeyRound, LogOut } from 'lucide-react'
import type { SyntheticEvent } from 'react'
import { useState } from 'react'
import { changePassword } from '../api/account'
import { ApiError } from '../api/errors'
import { useSession, useUser } from '../app/providers/sessionContext'
import { Button } from '../components/controls/Button'
import { TextField } from '../components/controls/TextField'
import { Page, PageHeader, Panel, Section } from '../components/layout/Page'
import styles from '../features/account/account.module.css'
import { formatDateTime } from '../utils/format'
import { userError } from '../utils/userError'

const PASSWORD_MIN = 12

export default function Account() {
  const user = useUser()
  const { signOut } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (current === '') found.current_password = 'Enter your current password.'
    if (next.length < PASSWORD_MIN) found.new_password = `Password must be at least ${PASSWORD_MIN} characters.`
    else if (confirm !== next) found.confirm = 'The passwords do not match.'
    setErrors(found)
    setMessage(null)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      await changePassword(current, next)
      setMessage({ ok: true, text: 'Password changed. You were signed out everywhere else.' })
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      if (err instanceof ApiError) setErrors(Object.fromEntries(err.fields.map((f) => [f.field, f.message])))
      setMessage({ ok: false, text: userError(err, 'Could not change the password').message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page label="Account">
      <PageHeader
        title="Account"
        eyebrow="Signed in"
        actions={
          <Button icon={<LogOut aria-hidden="true" />} onClick={() => void signOut()}>
            Sign out
          </Button>
        }
      />
      <Section id="profile" title="Profile">
        <Panel>
          <dl className={styles.details}>
            <dt>Name</dt>
            <dd>{user.display_name}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Member since</dt>
            <dd>{formatDateTime(user.created_at)}</dd>
          </dl>
        </Panel>
      </Section>
      <Section id="password" title="Change password" description="Changing your password signs you out on every other browser and device.">
        <Panel>
          <form className={styles.narrow} onSubmit={(event) => void submit(event)} noValidate>
            <TextField id="password-current" label="Current password" type="password" autoComplete="current-password" value={current} onChange={setCurrent} maxLength={256} error={errors.current_password} />
            <TextField id="password-new" label="New password" type="password" autoComplete="new-password" value={next} onChange={setNext} maxLength={256} error={errors.new_password} hint={`At least ${PASSWORD_MIN} characters.`} />
            <TextField id="password-confirm" label="Repeat new password" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} maxLength={256} error={errors.confirm} />
            {message !== null && (
              <p className={message.ok ? styles.success : styles.formError} role={message.ok ? 'status' : 'alert'}>
                {message.text}
              </p>
            )}
            <Button type="submit" variant="primary" busy={busy} icon={<KeyRound aria-hidden="true" />}>
              Change password
            </Button>
          </form>
        </Panel>
      </Section>
    </Page>
  )
}
