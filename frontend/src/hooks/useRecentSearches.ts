import { useCallback, useState } from 'react'

// Recent searches are a convenience, not library data: they belong to the
// window you searched in, so they live in localStorage rather than behind the
// API like the goal or the collections do. Every read and write is guarded —
// a webview with storage disabled should cost you the list, not the page.
const STORAGE_KEY = 'bookscape.recentSearches'
const RECENT_LIMIT = 5

export interface RecentSearch {
  query: string
  /** The right-hand caption: an author's name, or 'Author' for an author query. */
  meta: string
}

function readStored(): RecentSearch[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is RecentSearch => Boolean(entry) && typeof entry.query === 'string')
      .map((entry) => ({ query: entry.query, meta: typeof entry.meta === 'string' ? entry.meta : '' }))
      .slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

function writeStored(entries: RecentSearch[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* storage is full or unavailable — the in-memory list still works */
  }
}

function useRecentSearches() {
  const [recents, setRecents] = useState<RecentSearch[]>(readStored)

  // Matching case-insensitively so "dune" typed after "Dune" moves the existing
  // row to the top instead of stacking a near-duplicate next to it.
  const addRecent = useCallback((query: string, meta = '') => {
    const trimmed = query.trim()
    if (!trimmed) return
    setRecents((current) => {
      const needle = trimmed.toLowerCase()
      const next = [
        { query: trimmed, meta },
        ...current.filter((entry) => entry.query.toLowerCase() !== needle),
      ].slice(0, RECENT_LIMIT)
      writeStored(next)
      return next
    })
  }, [])

  const clearRecents = useCallback(() => {
    setRecents([])
    writeStored([])
  }, [])

  return { recents, addRecent, clearRecents }
}

export default useRecentSearches
