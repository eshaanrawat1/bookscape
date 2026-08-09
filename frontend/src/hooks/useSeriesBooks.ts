import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { normaliseBook } from '../utils.js'
import type { Book, RawBookPayload } from '../types.js'

function useSeriesBooks(seriesName: string) {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!seriesName) {
      setBooks([])
      setError('Could not load series books.')
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function loadSeriesBooks() {
      try {
        // The backend returns these already ordered by series number, so the
        // view renders them as-is rather than re-sorting text like "1.5".
        const data = await apiFetch<{ books?: RawBookPayload[] }>(`/series-books?series=${encodeURIComponent(seriesName)}`)
        if (cancelled) return
        setBooks((data.books || []).map(normaliseBook))
      } catch (err) {
        if (!cancelled) {
          setBooks([])
          setError(err instanceof Error ? err.message : 'Could not load series books.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadSeriesBooks()
    return () => { cancelled = true }
  }, [seriesName])

  return { books, loading, error }
}

export default useSeriesBooks
