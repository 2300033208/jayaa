import { Mountain, Trash2, Upload } from 'lucide-react'
import type { Data } from 'plotly.js-dist-min'
import type { SyntheticEvent } from 'react'
import { useMemo, useState } from 'react'
import type { TerrainUpload } from '../api/field'
import { deleteTerrainModel, getTerrainModel, getTerrainPreview, listTerrainModels, uploadTerrainModel } from '../api/field'
import { useTheme } from '../app/providers/themeContext'
import { ChartFrame } from '../components/charts/ChartFrame'
import { axis, baseLayout, sequentialScale } from '../components/charts/chartTheme'
import type { TableModel } from '../components/charts/DataTable'
import { Button } from '../components/controls/Button'
import { SegmentedField, SelectField } from '../components/controls/Choice'
import { FileField, TextField } from '../components/controls/TextField'
import { ConfirmDialog } from '../components/feedback/ConfirmDialog'
import { EmptyState, ErrorState, Skeleton } from '../components/feedback/States'
import { Page, PageHeader } from '../components/layout/Page'
import { ApiError } from '../api/errors'
import { useResource } from '../hooks/useResource'
import type { TerrainModel, TerrainPreview } from '../types/field'
import { formatDateTime, formatInteger } from '../utils/format'
import type { UserError } from '../utils/userError'
import { userError } from '../utils/userError'
import styles from '../features/field/field.module.css'

type CrsChoice = 'file' | 'geographic' | 'utm'
const MAX_BYTES = 64 * 1024 * 1024

function crsLabel(model: TerrainModel): string {
  const g = model.georeference
  if (g.crs === 'geographic') return `Latitude/longitude${model.datum ? ` (${model.datum})` : ''}`
  return `UTM zone ${String(g.utm_zone)}${g.hemisphere === 'south' ? 'S' : 'N'}${model.datum ? ` (${model.datum})` : ''}`
}

function cellText(model: TerrainModel): string {
  return model.cell_unit === 'degree' ? `${(model.cell_size * 3600).toPrecision(3)}″` : `${model.cell_size.toPrecision(3)} m`
}

function UploadPanel({ onUploaded }: { onUploaded: (model: TerrainModel) => void }) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [crs, setCrs] = useState<CrsChoice>('file')
  const [zone, setZone] = useState('')
  const [hemisphere, setHemisphere] = useState<'north' | 'south'>('north')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<UserError | null>(null)
  const [busy, setBusy] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const ascii = file !== null && /\.(asc|txt)$/i.test(file.name)

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (name.trim() === '') found.name = 'Name is required.'
    if (file === null) found.file = 'Choose an elevation file.'
    else if (!/\.(asc|txt|tif|tiff)$/i.test(file.name)) found.file = 'Upload an ESRI ASCII grid (.asc) or a GeoTIFF (.tif).'
    else if (file.size > MAX_BYTES) found.file = 'The file is larger than 64 MB.'
    if (ascii && crs === 'file') found.crs = 'An ASCII grid does not state its coordinate system; choose it here.'
    const zoneNumber = Number(zone)
    if (crs === 'utm' && !(Number.isInteger(zoneNumber) && zoneNumber >= 1 && zoneNumber <= 60)) found.utm_zone = 'UTM zones are 1–60.'
    setErrors(found)
    setFailure(null)
    if (Object.keys(found).length > 0 || file === null) return
    const upload: TerrainUpload = {
      name: name.trim(),
      file,
      crs: crs === 'file' ? null : crs,
      utmZone: crs === 'utm' ? zoneNumber : null,
      hemisphere: crs === 'utm' ? hemisphere : null,
    }
    setBusy(true)
    try {
      const model = await uploadTerrainModel(upload)
      onUploaded(model)
      setName('')
      setFile(null)
      setFormKey((n) => n + 1)
    } catch (error) {
      if (error instanceof ApiError) setErrors(Object.fromEntries(error.fields.map((f) => [f.field, f.message])))
      setFailure(userError(error, 'The elevation model was not accepted'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="terrain-upload-title">
      <h2 id="terrain-upload-title">Upload an elevation model</h2>
      <p className={styles.note}>
        A digital elevation model of the survey site: an ESRI ASCII grid (.asc) or a single-band GeoTIFF, heights in metres above sea level, in
        latitude/longitude (WGS 84, NAD83, ETRS89) or a UTM zone. Crop it to the site: at most 4 million cells.
      </p>
      <form key={formKey} className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <TextField id="terrain-name" label="Name" value={name} onChange={setName} maxLength={120} error={errors.name} disabled={busy} />
        <FileField id="terrain-file" label="Elevation file" accept=".asc,.txt,.tif,.tiff" onChange={setFile} error={errors.file} disabled={busy} hint="At most 64 MB." />
        <SelectField<CrsChoice>
          id="terrain-crs"
          label="Coordinate system"
          value={crs}
          options={[
            { value: 'file', label: 'As stated in the GeoTIFF' },
            { value: 'geographic', label: 'Latitude/longitude (degrees)' },
            { value: 'utm', label: 'UTM zone (metres)' },
          ]}
          onChange={setCrs}
          error={errors.crs}
          disabled={busy}
        />
        {crs === 'utm' && (
          <div className={styles.inline}>
            <TextField id="terrain-zone" label="UTM zone" value={zone} onChange={setZone} maxLength={2} error={errors.utm_zone} disabled={busy} />
            <SegmentedField<'north' | 'south'>
              id="terrain-hemisphere"
              label="Hemisphere"
              value={hemisphere}
              options={[
                { value: 'north', label: 'North' },
                { value: 'south', label: 'South' },
              ]}
              onChange={setHemisphere}
              error={errors.hemisphere}
              disabled={busy}
            />
          </div>
        )}
        <Button type="submit" variant="primary" busy={busy} icon={<Upload aria-hidden="true" />}>
          Upload
        </Button>
      </form>
      {failure !== null && <ErrorState compact headingLevel={3} error={failure} />}
    </section>
  )
}

function PreviewChart({ model, preview }: { model: TerrainModel; preview: TerrainPreview }) {
  const { tokens, resolved } = useTheme()
  const built = useMemo(() => {
    const geographic = preview.crs === 'geographic'
    const xTitle = geographic ? 'Longitude (°)' : 'Easting (m)'
    const yTitle = geographic ? 'Latitude (°)' : 'Northing (m)'
    const data: Data[] = [
      {
        type: 'heatmap',
        x: preview.x,
        y: preview.y,
        z: preview.heights,
        zsmooth: false,
        colorscale: sequentialScale(resolved === 'dark'),
        colorbar: {
          title: { text: 'Height (m)', side: 'right', font: { size: 11, color: tokens.ink2 } },
          thickness: 10,
          outlinewidth: 0,
          tickfont: { family: tokens.fontMono, size: 10, color: tokens.ink3 },
        },
        hovertemplate: `${geographic ? 'Lon' : 'E'} %{x:.6~g}<br>${geographic ? 'Lat' : 'N'} %{y:.7~g}<br>%{z:.1f} m<extra></extra>`,
        showlegend: false,
      },
    ]
    const layout = baseLayout(tokens, { xaxis: axis(tokens, xTitle), yaxis: axis(tokens, yTitle, geographic ? {} : { scaleanchor: 'x', scaleratio: 1 }) })
    const cols = preview.x.length
    const table: TableModel = {
      caption: `Heights every ${String(preview.step)} cells`,
      columns: [geographic ? 'Longitude (°)' : 'Easting (m)', geographic ? 'Latitude (°)' : 'Northing (m)', 'Height (m)'],
      rowCount: preview.y.length * cols,
      row: (i) => {
        const r = Math.floor(i / cols)
        const c = i % cols
        const h = preview.heights[r]?.[c] ?? null
        return [String(preview.x[c] ?? ''), String(preview.y[r] ?? ''), h === null ? 'no data' : h.toFixed(1)]
      },
    }
    return { data, layout, table }
  }, [preview, tokens, resolved])
  return (
    <ChartFrame
      id="terrain-preview"
      title="Heights"
      subtitle={`${model.name}: ${formatInteger(model.rows)} × ${formatInteger(model.columns)} cells of ${cellText(model)}, ${model.min_height_m.toFixed(0)} to ${model.max_height_m.toFixed(0)} m`}
      data={built.data}
      layout={built.layout}
      height={420}
      summary={`Elevation map of ${model.name}, heights from ${model.min_height_m.toFixed(0)} to ${model.max_height_m.toFixed(0)} metres.`}
      table={built.table}
      exportName={`terrain-${model.id.slice(0, 8)}`}
    />
  )
}

function SelectedModel({ model, onDeleted }: { model: TerrainModel; onDeleted: (id: string) => void }) {
  const detail = useResource(model.id, (signal) => getTerrainModel(model.id, signal), 'Elevation model unavailable')
  const preview = useResource(model.id, (signal) => getTerrainPreview(model.id, signal), 'Preview unavailable')
  const [confirm, setConfirm] = useState(false)
  const [deleteError, setDeleteError] = useState<UserError | null>(null)
  const usedBy = detail.status === 'ready' ? detail.data.used_by : null
  return (
    <section className={styles.column} aria-labelledby="terrain-selected-title">
      <div className={styles.statusRow}>
        <h2 id="terrain-selected-title">
          {model.name} <span className={styles.muted}>· {model.file_name}</span>
        </h2>
        <Button
          variant="danger"
          icon={<Trash2 aria-hidden="true" />}
          onClick={() => {
            setConfirm(true)
          }}
        >
          Delete
        </Button>
      </div>
      {deleteError && <ErrorState compact error={deleteError} />}
      <dl className={styles.facts}>
        <div>
          <dt>Coordinate system</dt>
          <dd>{crsLabel(model)}</dd>
        </div>
        <div>
          <dt>Grid</dt>
          <dd>
            {formatInteger(model.rows)} × {formatInteger(model.columns)} cells of {cellText(model)}
            {model.no_data_fraction > 0 && `, ${(model.no_data_fraction * 100).toFixed(1)} % without data`}
          </dd>
        </div>
        <div>
          <dt>Heights</dt>
          <dd>
            {model.min_height_m.toFixed(1)} to {model.max_height_m.toFixed(1)} m above sea level
          </dd>
        </div>
        <div>
          <dt>Used by</dt>
          <dd>{usedBy === null ? '…' : usedBy.length === 0 ? 'No experiment yet' : usedBy.join(', ')}</dd>
        </div>
      </dl>
      {preview.status === 'error' && <ErrorState compact error={preview.error} actions={<Button onClick={preview.reload}>Retry</Button>} />}
      {preview.status === 'ready' ? <PreviewChart model={model} preview={preview.data} /> : preview.status !== 'error' && <Skeleton height={420} label="Loading heights" />}
      <ConfirmDialog
        open={confirm}
        title="Delete this elevation model?"
        confirmLabel="Delete model"
        tone="danger"
        onConfirm={() => {
          setConfirm(false)
          setDeleteError(null)
          deleteTerrainModel(model.id).then(
            () => {
              onDeleted(model.id)
            },
            (error: unknown) => {
              setDeleteError(userError(error, 'The elevation model was not deleted'))
            },
          )
        }}
        onCancel={() => {
          setConfirm(false)
        }}
      >
        Experiments that use it must switch to another terrain first.
      </ConfirmDialog>
    </section>
  )
}

export default function TerrainPage() {
  const listResource = useResource('terrain-models', (signal) => listTerrainModels(signal), 'Elevation models unavailable')
  const [added, setAdded] = useState<TerrainModel[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const loaded = listResource.status === 'ready' ? listResource.data : null
  const models = useMemo(() => {
    if (loaded === null) return null
    const known = new Set(loaded.map((m) => m.id))
    return [...added.filter((m) => !known.has(m.id)), ...loaded].filter((m) => !removed.includes(m.id))
  }, [loaded, added, removed])
  const selected = models?.find((m) => m.id === selectedId) ?? models?.[0] ?? null

  return (
    <Page label="Elevation models">
      <PageHeader
        title="Elevation models"
        meta="Real terrain for the terrain-mass correction and the station heights. Choose “Elevation model” as the terrain of an experiment to use one."
      />
      <div className={styles.layout}>
        <div className={styles.column}>
          <UploadPanel
            onUploaded={(model) => {
              setAdded((list) => [model, ...list])
              setSelectedId(model.id)
            }}
          />
          <section className={styles.panel} aria-labelledby="terrain-list-title">
            <h2 id="terrain-list-title">Your models</h2>
            {listResource.status === 'error' ? (
              <ErrorState compact error={listResource.error} actions={<Button onClick={listResource.reload}>Retry</Button>} />
            ) : models === null ? (
              <Skeleton height={80} label="Loading elevation models" />
            ) : models.length === 0 ? (
              <p className={styles.note}>No elevation models yet.</p>
            ) : (
              <ul className={styles.history} aria-label="Elevation models">
                {models.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      aria-current={m.id === selected?.id}
                      onClick={() => {
                        setSelectedId(m.id)
                      }}
                    >
                      <span>{m.name}</span>
                      <span className={styles.historyMeta}>
                        {crsLabel(m)} · {formatDateTime(m.created_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className={styles.column}>
          {selected !== null ? (
            <SelectedModel
              key={selected.id}
              model={selected}
              onDeleted={(id) => {
                setRemoved((list) => [...list, id])
                setSelectedId(null)
              }}
            />
          ) : (
            models !== null && (
              <EmptyState icon={<Mountain />} title="No elevation model yet." message="Upload a DEM of your site to model its real terrain." />
            )
          )}
        </div>
      </div>
    </Page>
  )
}
