import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import type { ReadingHeatmap } from '../types.js'

// Fetches one calendar year of reading days. Kept separate from useStats rather
// than folded into it because the two answer to different filters: the summary
// narrows by year *and* month, while the heatmap is a year grid by definition
// and would only ever throw the month away.
function useHeatmap(year: number | null) {
  const [heatmap, setHeatmap] = useState<ReadingHeatmap | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (year === null) {
      setHeatmap(null)
      return undefined
    }

    let cancelled = false
    setLoading(true)

    apiFetch<ReadingHeatmap>(`/stats/heatmap?year=${year}`)
      .then((data) => {
        if (cancelled) return
        setHeatmap(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setHeatmap(null)
        setError(err instanceof Error ? err.message : 'Could not load reading days.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [year])

  return { heatmap, loading, error }
}

export default useHeatmap
