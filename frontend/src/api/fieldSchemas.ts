/*
 * Runtime parsers for accounts, field datasets and elevation models. Like every engine response, nothing
 * reaches the UI without passing through these: unknown statuses, non-finite numbers and inconsistent
 * array lengths are rejected.
 */

import type {
  AuthConfig,
  Dataset,
  FieldResults,
  FieldStations,
  FileProblem,
  ReferenceUsed,
  TerrainModel,
  TerrainModelDetail,
  TerrainPreview,
  User,
} from '../types/field'
import { DATASET_STATUSES, FIT_QUALITIES, STATION_SERIES, TERRAIN_CRS } from '../types/field'
import { TIDES } from '../types/config'
import type { Parser } from './parse'
import {
  ParseError,
  array,
  boolean,
  finite,
  finiteArray,
  fraction,
  isRecord,
  literal,
  nonNegativeInteger,
  nullable,
  object,
  refine,
  string,
} from './parse'
import { hash, id, nonNegative, parseInversionDoc, parseUncertaintyDoc, positive } from './schemas'

const timestamp = refine(string, (v) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) ? null : 'expected a UTC timestamp'))

export const parseUser: Parser<User> = object<User>({ id, email: string, display_name: string, created_at: string })

export const parseUserEnvelope: Parser<User> = (value, path) => {
  if (!isRecord(value)) throw new ParseError(path, 'expected an object')
  return parseUser(value.user, `${path}.user`)
}

export const parseAuthConfig: Parser<AuthConfig> = object<AuthConfig>({
  signup_allowed: boolean,
  password_min_length: nonNegativeInteger,
})

/* ------------------------------------------------------------------ field datasets */

export const parseDataset: Parser<Dataset> = object<Dataset>({
  id,
  experiment_id: id,
  name: string,
  file_name: string,
  file_sha256: hash,
  size_bytes: nonNegativeInteger,
  measurement_count: nonNegativeInteger,
  station_count: nonNegativeInteger,
  start_utc: timestamp,
  end_utc: timestamp,
  has_averaging_column: boolean,
  options: object({ reference_x_m: nullable(finite), reference_y_m: nullable(finite), reference_height_m: nullable(finite) }),
  status: literal(DATASET_STATUSES),
  progress: fraction,
  error: nullable(object({ code: string, message: string })),
  summary: nullable(
    object({ anomaly_detected: boolean, detection_significance_sigma: nullable(nonNegative), fit_quality: literal(FIT_QUALITIES) }),
  ),
  analysed_at: nullable(string),
  created_at: string,
  updated_at: string,
  configuration_hash: nullable(hash),
  experiment_version: nullable(nonNegativeInteger),
})

export const parseDatasetList: Parser<Dataset[]> = (value, path) =>
  object({ items: array(parseDataset) })(value, path).items

/** Problems listed by the engine when it rejects an upload (error.problems). */
export function parseFileProblems(value: unknown): FileProblem[] {
  if (!Array.isArray(value)) return []
  try {
    return array(object<FileProblem>({ line: nullable(nonNegativeInteger), column: nullable(string), message: string }))(value, 'problems')
  } catch {
    return []
  }
}

const stations: Parser<FieldStations> = (value, path) => {
  if (!isRecord(value)) throw new ParseError(path, 'expected an object')
  const out: Partial<FieldStations> = {
    station: array(string)(value.station, `${path}.station`),
    time_utc: array(timestamp)(value.time_utc, `${path}.time_utc`),
  }
  for (const key of STATION_SERIES) out[key] = finiteArray(value[key], `${path}.${key}`)
  const n = out.station?.length ?? 0
  for (const [key, series] of Object.entries(out)) {
    if (Array.isArray(series) && series.length !== n) throw new ParseError(`${path}.${key}`, `expected ${n} values, got ${series.length}`)
  }
  return out as FieldStations
}

const reference: Parser<ReferenceUsed> = (value, path) => {
  if (isRecord(value) && value.mode === 'remote') {
    return { mode: 'remote', distance_km: nonNegative(value.distance_km, `${path}.distance_km`) }
  }
  return { mode: 'local', ...object({ x_m: finite, y_m: finite, height_m: finite })(value, path) }
}

export const parseFieldResults: Parser<FieldResults> = refine(
  object<FieldResults>({
    dataset: parseDataset,
    summary: object({
      anomaly_detected: boolean,
      detection_significance_sigma: nullable(nonNegative),
      detection_description: string,
      primary_source: object({
        id: string,
        mass_kg: finite,
        x_m: finite,
        y_m: finite,
        depth_m: positive,
        depth_ci_low: nullable(finite),
        depth_ci_high: nullable(finite),
        mass_ci_low: nullable(finite),
        mass_ci_high: nullable(finite),
        mass_significance_sigma: nullable(nonNegative),
      }),
      measurement_count: nonNegativeInteger,
      station_count: nonNegativeInteger,
      median_uncertainty: positive,
      station_spacing_m: nonNegative,
      reduced_chi_square: nullable(nonNegative),
      fit_quality: literal(FIT_QUALITIES),
      duration_s: nonNegative,
    }),
    inversion: parseInversionDoc,
    uncertainty: parseUncertaintyDoc,
    corrections: object({
      normal_rms: nonNegative,
      terrain_rms: nonNegative,
      tide_rms: nonNegative,
      terrain_density_kg_m3: nonNegative,
      tides: literal(TIDES),
      reference,
    }),
    hypothesis: object({
      description: string,
      body_count: nonNegativeInteger,
      chi_square_null: nonNegative,
      chi_square_hypothesis: nonNegative,
      chi_square_fit: nonNegative,
      peak_signal: nonNegative,
    }),
    stations,
  }),
  (r) => (r.stations.station.length === r.summary.measurement_count ? null : 'station count does not match the summary'),
)

/* ------------------------------------------------------------------ elevation models */

const georeference = object<TerrainModel['georeference']>({
  crs: literal(TERRAIN_CRS),
  utm_zone: nullable(nonNegativeInteger),
  hemisphere: nullable(literal(['north', 'south'] as const)),
  x0: finite,
  y0: finite,
  dx: positive,
  dy: finite,
})

const terrainShape = {
  id,
  name: string,
  file_name: string,
  file_sha256: hash,
  size_bytes: nonNegativeInteger,
  created_at: string,
  rows: nonNegativeInteger,
  columns: nonNegativeInteger,
  cell_size: positive,
  cell_unit: literal(['degree', 'm'] as const),
  datum: nullable(string),
  min_height_m: finite,
  max_height_m: finite,
  no_data_fraction: fraction,
  extent: object({ x_min: finite, x_max: finite, y_min: finite, y_max: finite }),
  georeference,
}

export const parseTerrainModel: Parser<TerrainModel> = object<TerrainModel>(terrainShape)

export const parseTerrainModelDetail: Parser<TerrainModelDetail> = object<TerrainModelDetail>({
  ...terrainShape,
  used_by: array(string),
})

export const parseTerrainList: Parser<TerrainModel[]> = (value, path) =>
  object({ items: array(parseTerrainModel) })(value, path).items

export const parseTerrainPreview: Parser<TerrainPreview> = refine(
  object<TerrainPreview>({
    x: finiteArray,
    y: finiteArray,
    heights: array(array(nullable(finite))),
    crs: literal(TERRAIN_CRS),
    utm_zone: nullable(nonNegativeInteger),
    hemisphere: nullable(literal(['north', 'south'] as const)),
    step: nonNegativeInteger,
  }),
  (p) =>
    p.heights.length === p.y.length && p.heights.every((row) => row.length === p.x.length) ? null : 'height grid does not match its axes',
)
