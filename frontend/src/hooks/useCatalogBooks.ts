import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api.js'
import { normaliseBook } from '../utils.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import type { Book, RawBookPayload } from '../types.js'

// The catalog drilldowns — an author's books, a series, a genre — are one fetch
// with a different query string, so they share this hook instead of three copies
// that drift apart. Callers pass a ready-built url (empty when there is nothing
// to look up) and the message to show if it cannot be loaded.
//
// Reading `dataVersion` is what keeps these pages honest about reading state.
// The shelves on Library and Reading Now are rendered from the library context,
// so editing a book's status or pages in the dialog updates them; a drilldown
// owns its own results and would otherwise keep showing whatever the book looked
// like when the page was opened — a progress bar frozen at the page you were on
// before you just changed it.
function useCatalogBooks(url: string, missingMessage: string) {
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

    // A refresh is a re-run of the url already on screen, so it resolves into
    // place rather than throwing the page back to its loading state — the
    // dialog that triggered it is still open over the top.
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
        setError(err instanceof Error ? err.message : missingMessage)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [url, dataVersion, missingMessage])

  return { books, loading, error }
}

export default useCatalogBooks
