import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { normaliseBook, errorMessage } from '../utils.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import type { Highlight, HighlightGroup, RawHighlight, RawHighlightGroup } from '../types.js'

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

function normaliseGroup(raw: RawHighlightGroup): HighlightGroup | null {
  if (!raw?.book) return null
  return {
    bookId: String(raw.book_id || ''),
    book: normaliseBook(raw.book),
    count: Number(raw.count) || 0,
    highlights: (raw.highlights || []).map(normaliseHighlight),
  }
}

// Patch the one returned group: drop it if emptied, prepend if new (newest-highlight order).
function mergeGroup(groups: HighlightGroup[], updated: HighlightGroup): HighlightGroup[] {
  const rest = groups.filter((group) => group.bookId !== updated.bookId)
  if (updated.count === 0) return rest
  const existed = groups.some((group) => group.bookId === updated.bookId)
  return existed
    ? groups.map((group) => (group.bookId === updated.bookId ? updated : group))
    : [updated, ...rest]
}

function useHighlights() {
  const { dataVersion } = useLibraryData()
  const [groups, setGroups] = useState<HighlightGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch<{ groups?: RawHighlightGroup[] }>('/highlights')
      .then((data) => {
        if (cancelled) return
        setGroups((data.groups || []).map(normaliseGroup).filter((g): g is HighlightGroup => g !== null))
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
  }, [dataVersion])

  // Mutations rethrow so the calling form can stay open showing what failed.
  const applyGroup = (raw: RawHighlightGroup) => {
    const group = normaliseGroup(raw)
    if (group) setGroups((current) => mergeGroup(current, group))
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
