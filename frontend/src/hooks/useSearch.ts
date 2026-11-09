import { useEffect, useState } from 'react'
import { searchBookIds, errorMessage } from '../utils.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'

const RESULT_LIMIT = 24
const PREVIEW_LIMIT = 5

function useSearch() {
  const { booksByIds } = useLibraryData()
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [resultIds, setResultIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewIds, setPreviewIds] = useState<string[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    const nextQuery = draft.trim()
    const submittedQuery = query.trim()
    if (!nextQuery || nextQuery === submittedQuery) {
      setPreviewIds([])
      setPreviewLoading(false)
      return undefined
    }

    setPreviewIds([])
    setPreviewLoading(true)

    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const ids = await searchBookIds(nextQuery, PREVIEW_LIMIT)
        if (cancelled) return
        setPreviewIds(ids)
      } catch {
        if (cancelled) return
        setPreviewIds([])
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [draft, query])

  async function runSearch(rawQuery = draft) {
    const nextQuery = String(rawQuery || '').trim()
    setDraft(nextQuery)
    setQuery(nextQuery)

    if (!nextQuery) {
      setResultIds([])
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      setResultIds(await searchBookIds(nextQuery, RESULT_LIMIT))
    } catch (err) {
      setError(errorMessage(err, 'Could not search books.'))
      setResultIds([])
    } finally {
      setLoading(false)
    }
  }

  return {
    draft,
    query,
    results: booksByIds(resultIds),
    loading,
    error,
    previewResults: booksByIds(previewIds),
    previewLoading,
    setDraft,
    runSearch,
  }
}

export default useSearch
