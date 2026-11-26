import { Field } from './Field'
import { describedBy } from './fieldA11y'
import styles from './controls.module.css'

interface DateFieldProps {
  id: string
  label: string
  /** ISO date, YYYY-MM-DD. */
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  error?: string | undefined
  hint?: string
  disabled?: boolean
}

/** Native date input; the value stays an ISO string and is validated like every other field. */
export function DateField({ id, label, value, onChange, min, max, error, hint, disabled }: DateFieldProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <div className={styles.inputWrap}>
        <input
          id={id}
          type="date"
          className={styles.input}
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy(id, { error, hint })}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
      </div>
    </Field>
  )
}
