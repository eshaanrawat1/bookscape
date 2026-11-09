import { useEffect, useState } from 'react'
import { searchBooks, errorMessage } from '../utils.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import type { Book } from '../types.js'

const RESULT_LIMIT = 24
const PREVIEW_LIMIT = 5

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
        const results = await searchBooks(nextQuery, PREVIEW_LIMIT)
        if (cancelled) return
        setPreviewResults(results)
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

  // Quietly re-runs the submitted query after dialog edits, since only the reading state is stale.
  useEffect(() => {
    const submitted = query.trim()
    if (!submitted) return undefined

    let cancelled = false
    searchBooks(submitted, RESULT_LIMIT)
      .then((books) => {
        if (!cancelled) setResults(books)
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
      setResults(await searchBooks(nextQuery, RESULT_LIMIT))
    } catch (err) {
      setError(errorMessage(err, 'Could not search books.'))
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
