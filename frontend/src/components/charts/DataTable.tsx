import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../controls/Button'
import styles from './charts.module.css'

export interface TableModel {
  caption: string
  columns: readonly string[]
  rowCount: number
  /** Formatted cells for one row; called only for rows on the visible page. */
  row: (index: number) => readonly string[]
}

const PAGE_SIZE = 25

/** Paginated table view of a chart's data (the accessible equivalent of the chart). */
export function DataTable({ model }: { model: TableModel }) {
  const pages = Math.max(1, Math.ceil(model.rowCount / PAGE_SIZE))
  const [requestedPage, setPage] = useState(0)
  const page = Math.min(requestedPage, pages - 1)
  const start = page * PAGE_SIZE
  const end = Math.min(model.rowCount, start + PAGE_SIZE)
  const rows: { key: number; cells: readonly string[] }[] = []
  for (let i = start; i < end; i += 1) rows.push({ key: i, cells: model.row(i) })

  return (
    <div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption>{model.caption}</caption>
          <thead>
            <tr>
              {model.columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                {r.cells.map((cell, i) => (
                  <td key={model.columns[i] ?? i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.pager}>
        <span>
          Rows {model.rowCount === 0 ? 0 : start + 1}–{end} of {model.rowCount}
        </span>
        <div className={styles.pagerButtons}>
          <Button size="sm" variant="ghost" icon={<ChevronLeft />} aria-label="Previous page" disabled={page === 0} onClick={() => { setPage(page - 1) }} />
          <Button size="sm" variant="ghost" icon={<ChevronRight />} aria-label="Next page" disabled={page >= pages - 1} onClick={() => { setPage(page + 1) }} />
        </div>
      </div>
    </div>
  )
}
