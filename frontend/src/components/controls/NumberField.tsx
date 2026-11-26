import { useState } from 'react'
import { editableText, parseNumberInput } from './numberText'
import styles from './controls.module.css'

interface NumberInputProps {
  id: string
  value: number
  onChange: (value: number) => void
  unit?: string
  disabled?: boolean
  invalid?: boolean
  describedBy?: string | undefined
  ariaLabel?: string
  ariaLabelledBy?: string
  notation?: 'auto' | 'plain'
}

export function NumberInput({ id, value, onChange, unit, disabled, invalid, describedBy, ariaLabel, ariaLabelledBy, notation = 'auto' }: NumberInputProps) {
  const [text, setText] = useState(() => editableText(value, notation))
  const [synced, setSynced] = useState(value)

  // Resynchronize when the value changes from outside (slider, preset, reload). Values that
  // came from this input's own text are left alone so typing is never interrupted.
  if (!Object.is(value, synced)) {
    setSynced(value)
    if (!Object.is(parseNumberInput(text), value)) setText(editableText(value, notation))
  }

  return (
    <div className={styles.inputWrap}>
      <input
        id={id}
        className={styles.input}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={text}
        disabled={disabled}
        aria-invalid={invalid === true ? true : undefined}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          const parsed = parseNumberInput(next)
          setSynced(parsed)
          onChange(parsed)
        }}
        onBlur={() => {
          const parsed = parseNumberInput(text)
          if (Number.isFinite(parsed)) setText(editableText(parsed, notation))
        }}
      />
      {unit && (
        <span className={styles.unit} aria-hidden="true">
          {unit}
        </span>
      )}
    </div>
  )
}
