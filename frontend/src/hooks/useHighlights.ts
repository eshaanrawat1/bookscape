import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api.js'
import { errorMessage } from '../utils.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import type { Highlight, HighlightGroup } from '../types.js'

// Every highlight route answers with the full list, newest first, so there is nothing to merge.
async function sendHighlights(path: string, method: string, body?: object): Promise<Highlight[]> {
  const data = await apiFetch<{ highlights: Highlight[] }>(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return data.highlights
}

function useHighlights() {
  const { booksByIds } = useLibraryData()
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    sendHighlights('/highlights', 'GET')
      .then((loaded) => {
        if (cancelled) return
        setHighlights(loaded)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(errorMessage(err, 'Could not load your highlights.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const groups: HighlightGroup[] = useMemo(() => {
    const byBook = new Map<string, Highlight[]>()
    for (const highlight of highlights) {
      byBook.set(highlight.book_id, [...(byBook.get(highlight.book_id) || []), highlight])
    }
    return [...byBook].flatMap(([bookId, items]) => {
      const [book] = booksByIds([bookId])
      return book ? [{ book, highlights: items }] : []
    })
  }, [highlights, booksByIds])

  // Mutations rethrow so the calling form can stay open showing what failed.
  const updateHighlight = async (id: number, fields: Partial<Pick<Highlight, 'text' | 'page' | 'note'>>) => {
    setHighlights(await sendHighlights(`/highlights/${id}`, 'PATCH', fields))
  }

  const deleteHighlight = async (id: number) => {
    setHighlights(await sendHighlights(`/highlights/${id}`, 'DELETE'))
  }

  return { groups, loading, error, setHighlights, updateHighlight, deleteHighlight }
}

// Outside the hook because the book dialog creates highlights without mounting the view.
function createHighlight(bookId: string, text: string, page: number): Promise<Highlight[]> {
  return sendHighlights('/highlights', 'POST', { book_id: bookId, text, page })
}

export { createHighlight }
export default useHighlights
