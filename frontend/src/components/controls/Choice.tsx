import type { ReactNode } from 'react'
import { Field } from './Field'
import type { FieldMessages } from './fieldA11y'
import { describedBy } from './fieldA11y'
import styles from './controls.module.css'

export interface Option<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

interface SelectFieldProps<T extends string> extends FieldMessages {
  id: string
  label: string
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  readout?: ReactNode
}

export function SelectField<T extends string>({ id, label, value, options, onChange, disabled, error, warning, hint, readout }: SelectFieldProps<T>) {
  return (
    <Field id={id} label={label} error={error} warning={warning} hint={hint} readout={readout}>
      <select
        id={id}
        className={styles.select}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy(id, { error, warning, hint })}
        onChange={(event) => {
          const next = options.find((o) => o.value === event.target.value)
          if (next) onChange(next.value)
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

interface SegmentedProps<T extends string> {
  name: string
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
  ariaLabel?: string
  ariaLabelledBy?: string
  disabled?: boolean
}

/** Radio group styled as segments; fully keyboard accessible via native radios. */
export function Segmented<T extends string>({ name, value, options, onChange, ariaLabel, ariaLabelledBy, disabled }: SegmentedProps<T>) {
  return (
    <fieldset className={styles.segmented} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} disabled={disabled}>
      {options.map((option) => (
        <label key={option.value} className={styles.segment}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => {
              onChange(option.value)
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  )
}

interface SegmentedFieldProps<T extends string> extends FieldMessages {
  id: string
  label: string
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
  disabled?: boolean
}

export function SegmentedField<T extends string>({ id, label, value, options, onChange, disabled, error, warning, hint }: SegmentedFieldProps<T>) {
  return (
    <Field id={id} label={label} asGroup error={error} warning={warning} hint={hint}>
      <Segmented name={id} value={value} options={options} onChange={onChange} ariaLabelledBy={`${id}-label`} disabled={disabled} />
    </Field>
  )
}

interface ToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function Toggle({ label, checked, onChange, disabled }: ToggleProps) {
  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
      <span>{label}</span>
    </label>
  )
}
