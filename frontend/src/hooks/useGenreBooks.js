import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { normaliseBook } from '../utils.js'

function useGenreBooks(genreName) {
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

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
        const data = await apiFetch(`/genre-books?genre=${encodeURIComponent(genreName)}&limit=100`)
        if (cancelled) return
        setBooks((data.books || []).map(normaliseBook))
      } catch (err) {
        if (!cancelled) {
          setBooks([])
          setError(err.message || 'Could not load genre books.')
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
