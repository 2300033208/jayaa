import { Download, Upload } from 'lucide-react'
import type { SyntheticEvent } from 'react'
import { useState } from 'react'
import type { DatasetUpload } from '../../api/field'
import { datasetTemplateUrl } from '../../api/field'
import { Button } from '../../components/controls/Button'
import { Field } from '../../components/controls/Field'
import { describedBy } from '../../components/controls/fieldA11y'
import { FileField, TextField } from '../../components/controls/TextField'
import { ErrorState } from '../../components/feedback/States'
import type { SensorMode } from '../../types/config'
import type { UploadFailure } from './useDatasets'
import styles from './field.module.css'

const MAX_BYTES = 20 * 1024 * 1024

function OptionalNumber(props: { id: string; label: string; value: number | null; onChange: (v: number | null) => void; error?: string | undefined; disabled: boolean }) {
  const { id, label, value, onChange, error, disabled } = props
  const [text, setText] = useState(value === null ? '' : String(value))
  return (
    <Field id={id} label={label} error={error}>
      <input
        id={id}
        className={styles.input}
        inputMode="decimal"
        value={text}
        placeholder="first station"
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy(id, { error })}
        onChange={(event) => {
          const raw = event.target.value
          setText(raw)
          const trimmed = raw.trim()
          const parsed = Number(trimmed)
          onChange(trimmed === '' || !Number.isFinite(parsed) ? null : parsed)
        }}
      />
    </Field>
  )
}

export function UploadForm({
  experimentId,
  sensorMode,
  uploading,
  failure,
  onUpload,
}: {
  experimentId: string
  sensorMode: SensorMode
  uploading: boolean
  failure: UploadFailure | null
  onUpload: (upload: DatasetUpload) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [refX, setRefX] = useState<number | null>(null)
  const [refY, setRefY] = useState<number | null>(null)
  const [refZ, setRefZ] = useState<number | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formKey, setFormKey] = useState(0)

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (name.trim() === '') found.name = 'Name is required.'
    if (file === null) found.file = 'Choose a CSV file.'
    else if (file.size > MAX_BYTES) found.file = 'The file is larger than 20 MB.'
    else if (file.size === 0) found.file = 'The file is empty.'
    setErrors(found)
    if (Object.keys(found).length > 0 || file === null) return
    const ok = await onUpload({ name: name.trim(), file, referenceX: refX, referenceY: refY, referenceHeight: refZ })
    if (ok) {
      setName('')
      setFile(null)
      setFormKey((n) => n + 1) // clears the file input
    }
  }

  const fieldErrors = { ...failure?.fields, ...errors }
  return (
    <section className={styles.panel} aria-labelledby="field-upload-title">
      <h2 id="field-upload-title">Upload measurements</h2>
      <p className={styles.note}>
        A CSV with one row per clock comparison: <code>station</code>, <code>time_utc</code>, <code>x_m</code>, <code>y_m</code>, <code>height_m</code>,{' '}
        <code>fractional_shift</code>, <code>uncertainty</code> and optionally <code>averaging_s</code>. Positions are east/north offsets from the site centre;
        heights are above the site elevation.
      </p>
      <a className={styles.templateLink} href={datasetTemplateUrl(experimentId)} download>
        <Download aria-hidden="true" />
        Download the station template for this experiment
      </a>
      <form key={formKey} className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <TextField id="field-upload-name" label="Dataset name" value={name} onChange={setName} maxLength={120} error={fieldErrors.name} disabled={uploading} />
        <FileField
          id="field-upload-file"
          label="Measurement file"
          accept=".csv,text/csv"
          onChange={setFile}
          error={fieldErrors.file}
          hint="UTF-8 CSV, at most 20 MB. Text cells starting with = + - @ are refused."
          disabled={uploading}
        />
        {sensorMode === 'local_reference' && (
          <fieldset className={styles.fieldset} disabled={uploading}>
            <legend>Reference clock position (optional)</legend>
            <p className={styles.note}>Where the stationary reference clock stood. Left empty, the first measurement&rsquo;s station is used.</p>
            <div className={styles.inline}>
              <OptionalNumber id="field-upload-ref-x" label="East (m)" value={refX} onChange={setRefX} error={fieldErrors.reference_x_m} disabled={uploading} />
              <OptionalNumber id="field-upload-ref-y" label="North (m)" value={refY} onChange={setRefY} error={fieldErrors.reference_y_m} disabled={uploading} />
              <OptionalNumber id="field-upload-ref-z" label="Height (m)" value={refZ} onChange={setRefZ} error={fieldErrors.reference_height_m} disabled={uploading} />
            </div>
          </fieldset>
        )}
        <Button type="submit" variant="primary" busy={uploading} icon={<Upload aria-hidden="true" />}>
          Upload and analyse
        </Button>
      </form>
      {failure !== null && (
        <div className={styles.failure}>
          <ErrorState compact headingLevel={3} error={failure.error} />
          {failure.problems.length > 0 && (
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Problems found in the file">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">Column</th>
                    <th scope="col">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {failure.problems.map((p, i) => (
                    <tr key={`${String(p.line)}-${p.column ?? ''}-${String(i)}`}>
                      <td>{p.line ?? '—'}</td>
                      <td>{p.column ?? '—'}</td>
                      <td>{p.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

