import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { normaliseBook } from '../utils.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import type { Book, RawBookPayload } from '../types.js'

const RESULT_LIMIT = 24

function useSearch() {
  const { dataVersion } = useLibraryData()
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Book[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewResults, setPreviewResults] = useState<Book[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    const nextQuery = draft.trim()
    const submittedQuery = query.trim()
    if (!nextQuery || nextQuery === submittedQuery) {
      setPreviewResults([])
      setPreviewLoading(false)
      return undefined
    }

    setPreviewResults([])
    setPreviewLoading(true)

    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiFetch<{ results?: RawBookPayload[] }>(`/search?q=${encodeURIComponent(nextQuery)}&limit=5`)
        if (cancelled) return
        setPreviewResults((data.results || []).map(normaliseBook))
      } catch {
        if (cancelled) return
        setPreviewResults([])
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [draft, query])

  // Results are a snapshot of the catalog at the moment Enter was pressed, so an
  // edit made in the dialog on top of them — a status change, a page update —
  // would otherwise leave the card behind it showing the old reading state. This
  // re-runs the submitted query quietly: no loading state, because the results
  // are already on screen and only their reading half is stale.
  useEffect(() => {
    const submitted = query.trim()
    if (!submitted) return undefined

    let cancelled = false
    apiFetch<{ results?: RawBookPayload[] }>(`/search?q=${encodeURIComponent(submitted)}&limit=${RESULT_LIMIT}`)
      .then((data) => {
        if (!cancelled) setResults((data.results || []).map(normaliseBook))
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [dataVersion])

  async function runSearch(rawQuery = draft) {
    const nextQuery = String(rawQuery || '').trim()
    setDraft(nextQuery)
    setQuery(nextQuery)

    if (!nextQuery) {
      setResults([])
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<{ results?: RawBookPayload[] }>(`/search?q=${encodeURIComponent(nextQuery)}&limit=${RESULT_LIMIT}`)
      setResults((data.results || []).map(normaliseBook))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not search books.')
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  return {
    draft,
    query,
    results,
    loading,
    error,
    previewResults,
    previewLoading,
    setDraft,
    runSearch,
  }
}

export default useSearch
