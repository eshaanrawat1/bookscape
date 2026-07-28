import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { normaliseBook } from '../utils.js'
import type { Book, RawBookPayload } from '../types.js'

function useAuthorBooks(authorName: string) {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authorName) {
      setBooks([])
      setError('Could not load author books.')
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function loadAuthorBooks() {
      try {
        const data = await apiFetch<{ books?: RawBookPayload[] }>(`/author-books?author=${encodeURIComponent(authorName)}`)
        if (cancelled) return
        setBooks((data.books || []).map(normaliseBook))
      } catch (err) {
        if (!cancelled) {
          setBooks([])
          setError(err instanceof Error ? err.message : 'Could not load author books.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAuthorBooks()
    return () => { cancelled = true }
  }, [authorName])

  return { books, loading, error }
}

export default useAuthorBooks
