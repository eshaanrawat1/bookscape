import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { normaliseBook } from '../utils.js'
import type { Book, RawBookPayload } from '../types.js'

function useGenreBooks(genreName: string) {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!genreName) {
      setBooks([])
      setError('Could not load genre books.')
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function loadGenreBooks() {
      try {
        const data = await apiFetch<{ books?: RawBookPayload[] }>(`/genre-books?genre=${encodeURIComponent(genreName)}&limit=100`)
        if (cancelled) return
        setBooks((data.books || []).map(normaliseBook))
      } catch (err) {
        if (!cancelled) {
          setBooks([])
          setError(err instanceof Error ? err.message : 'Could not load genre books.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadGenreBooks()
    return () => { cancelled = true }
  }, [genreName])

  return { books, loading, error }
}

export default useGenreBooks
