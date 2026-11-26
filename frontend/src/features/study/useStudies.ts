import { useCallback, useEffect, useState } from 'react'
import { ApiError, isAbort } from '../../api/errors'
import { cancelStudy, getStudy, listStudies, startStudy } from '../../api/studies'
import type { Study, StudyRequest } from '../../types/studies'
import type { UserError } from '../../utils/userError'
import { userError } from '../../utils/userError'

const POLL_MS = 1000

export function isActiveStudy(study: Study): boolean {
  return study.status === 'queued' || study.status === 'running'
}

export interface StudiesState {
  list: Study[] | null
  listError: UserError | null
  selected: Study | null
  selectedError: UserError | null
  starting: boolean
  startError: UserError | null
  fieldErrors: Record<string, string>
  select: (id: string) => void
  start: (request: StudyRequest) => Promise<void>
  cancel: () => Promise<void>
  reloadList: () => void
}

/**
 * Studies of one experiment: the list, the selected study (with its result) and polling while it
 * runs. Polling stops as soon as the study reaches a terminal status; every response is validated.
 */
export function useStudies(experimentId: string): StudiesState {
  const [list, setList] = useState<Study[] | null>(null)
  const [listError, setListError] = useState<UserError | null>(null)
  const [listToken, setListToken] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Study | null>(null)
  const [selectedError, setSelectedError] = useState<UserError | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<UserError | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const controller = new AbortController()
    listStudies(experimentId, controller.signal).then(
      (items) => {
        setList(items)
        setListError(null)
        setSelectedId((current) => current ?? items[0]?.id ?? null)
      },
      (error: unknown) => {
        if (!isAbort(error)) setListError(userError(error, 'Studies unavailable'))
      },
    )
    return () => {
      controller.abort()
    }
  }, [experimentId, listToken])

  // Load the selected study, and keep polling while it is queued or running.
  useEffect(() => {
    if (selectedId === null) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      getStudy(selectedId, controller.signal).then(
        (study) => {
          setSelected(study)
          setSelectedError(null)
          setList((items) => items?.map((s) => (s.id === study.id ? { ...study, result: null } : s)) ?? items)
          if (isActiveStudy(study)) timer = globalThis.setTimeout(load, POLL_MS)
        },
        (error: unknown) => {
          if (!isAbort(error)) setSelectedError(userError(error, 'Study unavailable'))
        },
      )
    }
    load()
    return () => {
      controller.abort()
      if (timer !== null) globalThis.clearTimeout(timer)
    }
  }, [selectedId])

  const start = useCallback(
    async (request: StudyRequest) => {
      if (starting) return
      setStarting(true)
      setStartError(null)
      setFieldErrors({})
      try {
        const study = await startStudy(experimentId, request)
        setList((items) => [{ ...study, result: null }, ...(items ?? [])])
        setSelected(study)
        setSelectedId(study.id)
      } catch (error) {
        const fields = error instanceof ApiError ? error.fields : []
        setFieldErrors(Object.fromEntries(fields.map((f) => [f.field, f.message])))
        setStartError(userError(error, 'The study could not be started'))
      } finally {
        setStarting(false)
      }
    },
    [experimentId, starting],
  )

  const cancel = useCallback(async () => {
    if (selected === null || !isActiveStudy(selected)) return
    try {
      setSelected(await cancelStudy(selected.id))
    } catch (error) {
      setSelectedError(userError(error, 'The study could not be cancelled'))
    }
  }, [selected])

  return {
    list,
    listError,
    selected: selected !== null && selected.id === selectedId ? selected : null,
    selectedError,
    starting,
    startError,
    fieldErrors,
    select: setSelectedId,
    start,
    cancel,
    reloadList: () => {
      setListToken((n) => n + 1)
    },
  }
}
