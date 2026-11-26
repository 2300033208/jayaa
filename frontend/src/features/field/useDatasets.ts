import { useCallback, useEffect, useState } from 'react'
import { ApiError, isAbort } from '../../api/errors'
import type { DatasetUpload } from '../../api/field'
import { cancelDataset, deleteDataset, getDataset, getDatasetResults, listDatasets, reanalyseDataset, uploadDataset } from '../../api/field'
import { parseFileProblems } from '../../api/fieldSchemas'
import type { Dataset, FieldResults, FileProblem } from '../../types/field'
import type { UserError } from '../../utils/userError'
import { userError } from '../../utils/userError'

const POLL_MS = 1500

export interface UploadFailure {
  error: UserError
  fields: Record<string, string>
  problems: FileProblem[]
}

export interface DatasetsState {
  list: Dataset[] | null
  listError: UserError | null
  selected: Dataset | null
  results: FieldResults | null
  resultsError: UserError | null
  uploading: boolean
  uploadFailure: UploadFailure | null
  actionError: UserError | null
  select: (id: string) => void
  upload: (upload: DatasetUpload) => Promise<boolean>
  reanalyse: () => Promise<void>
  cancel: () => Promise<void>
  remove: () => Promise<void>
  reloadList: () => void
}

/**
 * Field datasets of one experiment: the list, the selected dataset (polled while its analysis runs) and its
 * results once ready. Every response passes the runtime parsers; upload rejections keep the engine's list of
 * problems with line and column.
 */
export function useDatasets(experimentId: string): DatasetsState {
  const [list, setList] = useState<Dataset[] | null>(null)
  const [listError, setListError] = useState<UserError | null>(null)
  const [listToken, setListToken] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Dataset | null>(null)
  const [results, setResults] = useState<FieldResults | null>(null)
  const [resultsError, setResultsError] = useState<{ id: string; error: UserError } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadFailure, setUploadFailure] = useState<UploadFailure | null>(null)
  const [actionError, setActionError] = useState<UserError | null>(null)
  const [pollToken, setPollToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listDatasets(experimentId, controller.signal).then(
      (items) => {
        setList(items)
        setListError(null)
        setSelectedId((current) => current ?? items[0]?.id ?? null)
      },
      (error: unknown) => {
        if (!isAbort(error)) setListError(userError(error, 'Field data unavailable'))
      },
    )
    return () => {
      controller.abort()
    }
  }, [experimentId, listToken])

  // The selected dataset, polled while it is analysed; its results are loaded once it is ready.
  useEffect(() => {
    if (selectedId === null) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      getDataset(selectedId, controller.signal).then(
        (dataset) => {
          setSelected(dataset)
          setList((items) => items?.map((d) => (d.id === dataset.id ? dataset : d)) ?? items)
          if (dataset.status === 'analysing') {
            timer = globalThis.setTimeout(load, POLL_MS)
            return
          }
          if (dataset.status !== 'ready') {
            setResults(null)
            return
          }
          getDatasetResults(selectedId, controller.signal).then(
            (doc) => {
              setResults(doc)
              setResultsError(null)
            },
            (error: unknown) => {
              if (!isAbort(error)) setResultsError({ id: selectedId, error: userError(error, 'Results unavailable') })
            },
          )
        },
        (error: unknown) => {
          if (!isAbort(error)) setResultsError({ id: selectedId, error: userError(error, 'Dataset unavailable') })
        },
      )
    }
    load()
    return () => {
      controller.abort()
      if (timer !== null) globalThis.clearTimeout(timer)
    }
  }, [selectedId, pollToken])

  const upload = useCallback(
    async (request: DatasetUpload) => {
      if (uploading) return false
      setUploading(true)
      setUploadFailure(null)
      try {
        const dataset = await uploadDataset(experimentId, request)
        setList((items) => [dataset, ...(items ?? [])])
        setSelected(dataset)
        setSelectedId(dataset.id)
        return true
      } catch (error) {
        const api = error instanceof ApiError ? error : null
        setUploadFailure({
          error: userError(error, 'The file was not accepted'),
          fields: Object.fromEntries((api?.fields ?? []).map((f) => [f.field, f.message])),
          problems: parseFileProblems(api?.details.problems),
        })
        return false
      } finally {
        setUploading(false)
      }
    },
    [experimentId, uploading],
  )

  const reanalyse = useCallback(async () => {
    if (selected === null) return
    setActionError(null)
    try {
      setSelected(await reanalyseDataset(selected.id))
      setPollToken((n) => n + 1)
    } catch (error) {
      setActionError(userError(error, 'The analysis could not be started'))
    }
  }, [selected])

  const cancel = useCallback(async () => {
    if (selected?.status !== 'analysing') return
    setActionError(null)
    try {
      await cancelDataset(selected.id)
      setPollToken((n) => n + 1)
    } catch (error) {
      setActionError(userError(error, 'The analysis could not be cancelled'))
    }
  }, [selected])

  const remove = useCallback(async () => {
    if (selected === null) return
    setActionError(null)
    try {
      await deleteDataset(selected.id)
      const remaining = (list ?? []).filter((d) => d.id !== selected.id)
      setList(remaining)
      setSelected(null)
      setResults(null)
      setSelectedId(remaining[0]?.id ?? null)
    } catch (error) {
      setActionError(userError(error, 'The dataset could not be deleted'))
    }
  }, [list, selected])

  return {
    list,
    listError,
    selected: selected !== null && selected.id === selectedId ? selected : null,
    results: results !== null && results.dataset.id === selectedId ? results : null,
    resultsError: resultsError !== null && resultsError.id === selectedId ? resultsError.error : null,
    uploading,
    uploadFailure,
    actionError,
    select: setSelectedId,
    upload,
    reanalyse,
    cancel,
    remove,
    reloadList: () => {
      setListToken((n) => n + 1)
    },
  }
}
