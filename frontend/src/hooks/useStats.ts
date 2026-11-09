import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api.js'
import type { StatsSummary } from '../types.js'
import { errorMessage } from '../utils.js'

function useStats() {
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // '' is all time. Opens on the current year; an empty year redirects below.
  const [year, setYear] = useState(String(new Date().getFullYear()))
  // The fallback fires at most once, and only against the default year.
  const redirected = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function loadStats() {
      setLoading(true)
      // Set when this response only names the year to ask for, so the page stays on "loading".
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
        if (!cancelled) setError(errorMessage(err, 'Could not load stats.'))
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
