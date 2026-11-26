import { Field } from './Field'
import type { FieldMessages } from './fieldA11y'
import { describedBy } from './fieldA11y'
import styles from './controls.module.css'

interface TextFieldProps extends FieldMessages {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'password'
  autoComplete?: string
  maxLength?: number
  required?: boolean
  disabled?: boolean
}

/** Single-line text input (names, email addresses, passwords) in the shared field layout. */
export function TextField({ id, label, value, onChange, type = 'text', autoComplete, maxLength, required, disabled, error, warning, hint }: TextFieldProps) {
  return (
    <Field id={id} label={label} error={error} warning={warning} hint={hint}>
      <input
        id={id}
        type={type}
        className={`${styles.input} ${styles.text}`}
        value={value}
        autoComplete={autoComplete}
        maxLength={maxLength}
        required={required}
        disabled={disabled}
        spellCheck={type === 'text' ? undefined : false}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy(id, { error, warning, hint })}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
    </Field>
  )
}

interface FileFieldProps extends FieldMessages {
  id: string
  label: string
  accept: string
  onChange: (file: File | null) => void
  disabled?: boolean
}

/** File picker; the file is only read by the engine, which validates it. */
export function FileField({ id, label, accept, onChange, disabled, error, warning, hint }: FileFieldProps) {
  return (
    <Field id={id} label={label} error={error} warning={warning} hint={hint}>
      <input
        id={id}
        type="file"
        className={styles.file}
        accept={accept}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy(id, { error, warning, hint })}
        onChange={(event) => {
          onChange(event.target.files?.[0] ?? null)
        }}
      />
    </Field>
  )
}
