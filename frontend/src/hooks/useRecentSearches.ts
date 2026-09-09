import { useCallback, useState } from 'react'

// Recent searches are a convenience, not library data: they belong to the
// window you searched in, so they live in localStorage rather than behind the
// API like the goal or the collections do. Every read and write is guarded —
// a webview with storage disabled should cost you the list, not the page.
const STORAGE_KEY = 'bookscape.recentSearches'
const RECENT_LIMIT = 5

function readStored(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

function writeStored(entries: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* storage is full or unavailable — the in-memory list still works */
  }
}

function useRecentSearches() {
  const [recents, setRecents] = useState<string[]>(readStored)

  // Matching case-insensitively so "dune" typed after "Dune" moves the existing
  // row to the top instead of stacking a near-duplicate next to it.
  const addRecent = useCallback((query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return
    setRecents((current) => {
      const needle = trimmed.toLowerCase()
      const next = [trimmed, ...current.filter((entry) => entry.toLowerCase() !== needle)].slice(0, RECENT_LIMIT)
      writeStored(next)
      return next
    })
  }, [])

  const removeRecent = useCallback((query: string) => {
    setRecents((current) => {
      const next = current.filter((entry) => entry !== query)
      writeStored(next)
      return next
    })
  }, [])

  const clearRecents = useCallback(() => {
    setRecents([])
    writeStored([])
  }, [])

  return { recents, addRecent, removeRecent, clearRecents }
}

export default useRecentSearches
