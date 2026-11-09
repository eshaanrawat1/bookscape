import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api.js'
import { errorMessage } from '../utils.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import type { Highlight, HighlightGroup, RawHighlight, RawHighlightGroup } from '../types.js'

type StoredGroup = Pick<HighlightGroup, 'bookId' | 'highlights'>

function normaliseHighlight(raw: RawHighlight): Highlight {
  return {
    id: Number(raw.id),
    bookId: String(raw.book_id || ''),
    text: String(raw.text || ''),
    page: Number(raw.page) || 0,
    note: String(raw.note || ''),
    createdAt: String(raw.created_at || ''),
    updatedAt: String(raw.updated_at || ''),
  }
}

function normaliseGroup(raw: RawHighlightGroup): StoredGroup {
  return {
    bookId: String(raw.book_id || ''),
    highlights: (raw.highlights || []).map(normaliseHighlight),
  }
}

// Mutations answer with one book's group: an emptied book drops out, a new one is prepended.
function mergeGroup(groups: StoredGroup[], updated: StoredGroup): StoredGroup[] {
  const rest = groups.filter((group) => group.bookId !== updated.bookId)
  if (updated.highlights.length === 0) return rest
  const existed = groups.some((group) => group.bookId === updated.bookId)
  return existed
    ? groups.map((group) => (group.bookId === updated.bookId ? updated : group))
    : [updated, ...rest]
}

function useHighlights() {
  const { booksByIds } = useLibraryData()
  const [stored, setStored] = useState<StoredGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch<{ groups?: RawHighlightGroup[] }>('/highlights')
      .then((data) => {
        if (cancelled) return
        setStored((data.groups || []).map(normaliseGroup))
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

  const groups: HighlightGroup[] = useMemo(() => stored.flatMap((group) => {
    const [book] = booksByIds([group.bookId])
    return book ? [{ ...group, book, count: group.highlights.length }] : []
  }), [stored, booksByIds])

  // Mutations rethrow so the calling form can stay open showing what failed.
  const applyGroup = (raw: RawHighlightGroup) => {
    setStored((current) => mergeGroup(current, normaliseGroup(raw)))
  }

  const updateHighlight = async (id: number, fields: Partial<Pick<Highlight, 'text' | 'page' | 'note'>>) => {
    const data = await apiFetch<RawHighlightGroup>(`/highlights/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    applyGroup(data)
  }

  const deleteHighlight = async (id: number) => {
    const data = await apiFetch<RawHighlightGroup>(`/highlights/${id}`, { method: 'DELETE' })
    applyGroup(data)
  }

  return { groups, loading, error, applyGroup, updateHighlight, deleteHighlight }
}

// Outside the hook because the book dialog creates highlights without mounting the view.
async function createHighlight(bookId: string, text: string, page: number): Promise<RawHighlightGroup> {
  return apiFetch<RawHighlightGroup>('/highlights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ book_id: bookId, text, page }),
  })
}

export { createHighlight }
export default useHighlights
