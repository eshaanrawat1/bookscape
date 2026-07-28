import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { normaliseBook } from '../utils.js'

function useSearch() {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [previewResults, setPreviewResults] = useState([])
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
        const data = await apiFetch(`/search?q=${encodeURIComponent(nextQuery)}&limit=5`)
        if (cancelled) return
        setPreviewResults((data.results || []).map(normaliseBook))
      } catch (err) {
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
      const data = await apiFetch(`/search?q=${encodeURIComponent(nextQuery)}&limit=24`)
      setResults((data.results || []).map(normaliseBook))
    } catch (err) {
      setError(err.message || 'Could not search books.')
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
