import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api.js'
import type { StatsSummary } from '../types.js'

function useStats() {
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // '' is all time. The page opens on the year you are living in rather than on
  // the whole shelf, because that is the one the bar chart has something to say
  // about; a library with nothing finished this year is redirected below.
  const [year, setYear] = useState(String(new Date().getFullYear()))
  // The fallback fires at most once, and only against the default above — every
  // other value comes from the picker, which only offers years that have books.
  const redirected = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function loadStats() {
      setLoading(true)
      // Set when this response only tells us which year to ask for, so the page
      // stays on "loading" across the hand-off instead of flashing "no books".
      let handingOff = false
      try {
        const suffix = year ? `?year=${year}` : ''
        const data = await apiFetch<StatsSummary>(`/stats${suffix}`)
        if (cancelled) return
        handingOff = !redirected.current
          && data.books_read === 0
          && data.available_years.length > 0
        redirected.current = true
        if (handingOff) {
          setYear(String(data.available_years[0]))
          return
        }
        setSummary(data)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load stats.')
      } finally {
        if (!cancelled && !handingOff) setLoading(false)
      }
    }

    loadStats()
    return () => { cancelled = true }
  }, [year])

  return { summary, loading, error, year, setYear }
}

export default useStats
