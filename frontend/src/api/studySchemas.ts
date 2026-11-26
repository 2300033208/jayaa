/* Runtime validation of Monte Carlo study and survey design responses. */
import type {
  Accuracy,
  DesignCandidate,
  DesignResult,
  Proportion,
  RepeatRecord,
  RepeatResult,
  Study,
  StudyRequest,
  StudyResult,
  SweepResult,
  TimeLapseRecord,
  TimeLapseResult,
} from '../types/studies'
import { STUDY_KINDS, STUDY_STATUSES } from '../types/studies'
import type { Parser } from './parse'
import { ParseError, array, boolean, finite, finiteArray, fraction, isRecord, literal, nonNegativeInteger, nullable, object, refine, string } from './parse'
import { hash, id, nonNegative, positive } from './schemas'

const proportion: Parser<Proportion> = refine(
  object<Proportion>({ k: nonNegativeInteger, n: nonNegativeInteger, rate: nullable(fraction), low: nullable(fraction), high: nullable(fraction) }),
  (p) => (p.k > p.n ? 'successes exceed trials' : (p.n === 0) !== (p.rate === null) ? 'rate must be null exactly when n is 0' : null),
)

const accuracy: Parser<Accuracy> = object<Accuracy>({ n: nonNegativeInteger, bias: nullable(finite), rmse: nullable(nonNegative), coverage: proportion })

function repeatParams<T>(item: Parser<T>) {
  return object({ depth_m: item, mass_kg: item, x_m: item, y_m: item })
}

const significance = object({ median: nullable(nonNegative), values: finiteArray })

const repeatResult: Parser<RepeatResult> = object<RepeatResult>({
  kind: literal(['repeat'] as const),
  runs: nonNegativeInteger,
  stations: nonNegativeInteger,
  bootstrap_samples: nonNegativeInteger,
  truth: repeatParams(finite),
  detection: proportion,
  significance,
  accuracy_all: repeatParams(accuracy),
  accuracy_detected: repeatParams(accuracy),
  records: array(
    object<RepeatRecord>({
      seed: nonNegativeInteger,
      detected: boolean,
      significance_sigma: nullable(nonNegative),
      depth_m: finite,
      mass_kg: finite,
      x_m: finite,
      y_m: finite,
      truth_within_ci: repeatParams(nullable(boolean)),
    }),
  ),
})

const sweepResult: Parser<SweepResult> = refine(
  object<SweepResult>({
    kind: literal(['sweep'] as const),
    runs_per_cell: nonNegativeInteger,
    stations: nonNegativeInteger,
    masses_kg: finiteArray,
    depths_m: finiteArray,
    detection: array(array(nullable(proportion))),
    predicted_probability: array(array(nullable(fraction))),
    effective_trials: positive,
    threshold_sigma: positive,
    note: string,
  }),
  (s) =>
    s.detection.length !== s.depths_m.length || s.predicted_probability.length !== s.depths_m.length
      ? 'expected one row per depth'
      : [...s.detection, ...s.predicted_probability].some((row) => row.length !== s.masses_kg.length)
        ? 'expected one value per mass in every row'
        : null,
)

const changeParams = <T>(item: Parser<T>) => object({ mass_change_kg: item, depth_m: item })

const timeLapseResult: Parser<TimeLapseResult> = object<TimeLapseResult>({
  kind: literal(['time_lapse'] as const),
  runs: nonNegativeInteger,
  stations: nonNegativeInteger,
  bootstrap_samples: nonNegativeInteger,
  mass_change_kg: finite,
  interval_days: positive,
  mass_change_rate_kg_per_year: finite,
  truth: object({ mass_change_kg: finite, depth_m: positive, mass_before_kg: finite, mass_after_kg: finite }),
  sigma_difference: nonNegative,
  sigma_difference_without_benchmarks: nonNegative,
  predicted_probability: fraction,
  detection: proportion,
  significance,
  accuracy_all: changeParams(accuracy),
  accuracy_detected: changeParams(accuracy),
  records: array(
    object<TimeLapseRecord>({
      seed: nonNegativeInteger,
      detected: boolean,
      significance_sigma: nonNegative,
      mass_change_kg: finite,
      depth_m: finite,
      truth_within_ci: changeParams(nullable(boolean)),
    }),
  ),
  note: string,
})

const studyResult: Parser<StudyResult> = (value, path) => {
  const kind = isRecord(value) ? value.kind : undefined
  if (kind === 'repeat') return repeatResult(value, path)
  if (kind === 'sweep') return sweepResult(value, path)
  if (kind === 'time_lapse') return timeLapseResult(value, path)
  throw new ParseError(`${path}.kind`, `expected one of ${STUDY_KINDS.join(', ')}`)
}

const optionalNumbers: Parser<number[] | undefined> = (value, path) => (value === null || value === undefined ? undefined : finiteArray(value, path))
const optionalNumber: Parser<number | undefined> = (value, path) => (value === null || value === undefined ? undefined : finite(value, path))

export const parseStudy: Parser<Study> = refine(
  object<Study>({
    id,
    experiment_id: id,
    experiment_version: nonNegativeInteger,
    configuration_hash: hash,
    kind: literal(STUDY_KINDS),
    request: object<StudyRequest>({
      kind: literal(STUDY_KINDS),
      runs: nonNegativeInteger,
      masses_kg: optionalNumbers,
      depths_m: optionalNumbers,
      mass_change_kg: optionalNumber,
      interval_days: optionalNumber,
    }),
    status: literal(STUDY_STATUSES),
    progress: fraction,
    created_at: string,
    completed_at: nullable(string),
    error: nullable(object({ code: string, message: string })),
    result: (value, path) => (value === undefined || value === null ? null : studyResult(value, path)),
  }),
  (s) =>
    s.result !== null && s.result.kind !== s.kind
      ? 'result kind does not match the study'
      : s.status === 'failed' && s.error === null
        ? 'a failed study must carry its error'
        : s.status === 'completed' && s.progress !== 1
          ? 'a completed study must be at 100 %'
          : null,
)

export const parseStudyList: Parser<Study[]> = (value, path) => object({ items: array(parseStudy) })(value, path).items

const designCandidate: Parser<DesignCandidate> = object<DesignCandidate>({
  spacing_m: positive,
  stations: nonNegativeInteger,
  averaging_time_s: positive,
  duration_days: nonNegative,
  nominal_sigma: nonNegative,
  expected_significance_sigma: nonNegative,
  detection_probability: fraction,
  within_budget: boolean,
  resolves_depth: boolean,
})

export const parseDesign: Parser<DesignResult> = refine(
  object<DesignResult>({
    target: object({ mass_kg: positive, depth_m: positive, x_m: finite, y_m: finite }),
    max_days: positive,
    target_probability: fraction,
    threshold_sigma: positive,
    verdict: literal(['reliable', 'best_within_budget', 'none_within_budget'] as const),
    recommended: nullable(designCandidate),
    candidates: array(designCandidate),
    assumptions: string,
  }),
  (d) => ((d.verdict === 'none_within_budget') !== (d.recommended === null) ? 'a recommendation must exist exactly when a design fits the budget' : null),
)
