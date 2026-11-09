import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api.js'
import { normaliseBook, errorMessage } from '../utils.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import type { Book, CatalogBooks, RawBookPayload } from '../types.js'

// Shared fetch for author/series/genre pages; dataVersion refetches so reading state doesn't go stale.
function useCatalogBooks(url: string, missingMessage: string): CatalogBooks {
  const { dataVersion } = useLibraryData()
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadedUrlRef = useRef('')

  useEffect(() => {
    if (!url) {
      setBooks([])
      setError(missingMessage)
      setLoading(false)
      return undefined
    }

    // A refresh of the current url resolves in place, without going back to a loading state.
    const isRefresh = loadedUrlRef.current === url
    loadedUrlRef.current = url

    let cancelled = false
    setLoading(!isRefresh)
    setError(null)

    apiFetch<{ books?: RawBookPayload[] }>(url)
      .then((data) => {
        if (cancelled) return
        setBooks((data.books || []).map(normaliseBook))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setBooks([])
        setError(errorMessage(err, missingMessage))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [url, dataVersion, missingMessage])

  return { books, loading, error }
}

export default useCatalogBooks
