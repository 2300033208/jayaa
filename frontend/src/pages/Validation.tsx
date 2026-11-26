import { CircleCheck, CircleX } from 'lucide-react'
import { getBenchmarks } from '../api/research'
import { Banner, ErrorState, Skeleton } from '../components/feedback/States'
import { Page, PageHeader, Panel, Section } from '../components/layout/Page'
import { Button } from '../components/controls/Button'
import { useResource } from '../hooks/useResource'
import type { Benchmark, BenchmarkRow } from '../types/research'
import { formatQuantity } from '../utils/units'
import styles from '../features/research/research.module.css'

function value(v: number | null, unit: string): string {
  if (v === null) return '—'
  const abs = Math.abs(v)
  const text = abs !== 0 && (abs < 1e-3 || abs >= 1e5) ? formatQuantity(v, 'fractional', { significant: 6 }) : formatQuantity(v, 'ratio', { significant: 6 })
  return unit ? `${text} ${unit}` : text
}

function RowView({ row }: { row: BenchmarkRow }) {
  return (
    <tr data-passed={row.passed}>
      <th scope="row">
        {row.quantity}
        {row.note && <span className={styles.note}>{row.note}</span>}
      </th>
      <td className="mono">{value(row.engine, row.unit)}</td>
      <td className="mono">
        {value(row.published, row.unit)}
        {row.published_sigma !== null && ` ± ${value(row.published_sigma, '')}`}
      </td>
      <td className="mono">{row.z === null ? value(row.difference, row.unit) : `z = ${formatQuantity(row.z, 'ratio', { significant: 2 })}`}</td>
      <td>
        <span className={styles.result} data-passed={row.passed}>
          {row.passed ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
          {row.passed ? 'Agrees' : 'Disagrees'}
        </span>
        <span className={styles.note}>{row.criterion}</span>
      </td>
    </tr>
  )
}

function BenchmarkView({ item, index }: { item: Benchmark; index: number }) {
  return (
    <Section id={item.id} number={String(index + 1).padStart(2, '0')} title={item.title} description={item.what_is_checked}>
      <Panel>
        <p className={styles.citation}>
          {item.citation}{' '}
          <a href={`https://doi.org/${item.doi}`} target="_blank" rel="noreferrer">
            doi:{item.doi}
          </a>
        </p>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={`${item.title}: engine against published values (scrollable)`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Quantity</th>
                <th scope="col">Engine</th>
                <th scope="col">Published</th>
                <th scope="col">Difference</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {item.rows.map((row) => (
                <RowView key={row.quantity} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Section>
  )
}

const POSITIONING = [
  {
    work: 'Bondarescu et al. 2012 (GJI)',
    did: 'Forward models: a buried sphere is “detectable” when its potential exceeds the clock threshold; proposed joint clock + gravimeter surveys.',
    here: 'Tests detection with realistic noise, logistics and a calibrated look-elsewhere test, and quantifies the joint survey against a gravimeter on the same stations.',
  },
  {
    work: 'Lion et al. 2017 (J. Geodesy)',
    did: 'Synthetic geoid determination: a few clock points added to gravimetry improve a regional geopotential model.',
    here: 'Targets a buried body rather than the geoid, and reports the source’s mass and depth with bootstrap and Cramér–Rao uncertainties.',
  },
  {
    work: 'Grotti et al. 2018; Takamoto et al. 2020',
    did: 'Field demonstrations of chronometric levelling between two clocks at fixed sites.',
    here: 'Reproduces both results with the engine’s physics (above), then simulates multi-station surveys that no experiment has yet performed.',
  },
]

export default function Validation() {
  const result = useResource('benchmarks', (signal) => getBenchmarks(signal), 'Benchmarks unavailable')
  return (
    <Page label="Validation">
      <PageHeader
        eyebrow="Scientific validation"
        title="Published results, recomputed"
        meta="Each check recomputes a published number with the same physics functions the simulator uses. Nothing is fitted to the published values."
      />
      {result.status === 'loading' && <Skeleton height={320} label="Recomputing published results" />}
      {result.status === 'error' && (
        <ErrorState
          error={result.error}
          actions={
            <Button variant="primary" onClick={result.reload}>
              Try again
            </Button>
          }
        />
      )}
      {result.status === 'ready' && (
        <>
          <Banner tone={result.data.passed === result.data.total ? 'info' : 'critical'} title={`${String(result.data.passed)} of ${String(result.data.total)} checks agree`}>
            {result.data.method}
          </Banner>
          {result.data.benchmarks.map((item, i) => (
            <BenchmarkView key={item.id} item={item} index={i} />
          ))}
        </>
      )}
      <Section id="positioning" title="How this work differs from the literature" description="What earlier studies did, and what this simulator adds.">
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Related work (scrollable)">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Study</th>
                <th scope="col">What it did</th>
                <th scope="col">What this simulator adds</th>
              </tr>
            </thead>
            <tbody>
              {POSITIONING.map((p) => (
                <tr key={p.work}>
                  <th scope="row">{p.work}</th>
                  <td className={styles.wrap}>{p.did}</td>
                  <td className={styles.wrap}>{p.here}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </Page>
  )
}
