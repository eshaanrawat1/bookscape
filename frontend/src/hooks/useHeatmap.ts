import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import type { ReadingHeatmap } from '../types.js'

// Fetches one calendar year of reading days. Kept separate from useStats rather
// than folded into it because the two answer to different filters: the summary
// narrows by year *and* month, while the heatmap is a year grid by definition
// and would only ever throw the month away.
function useHeatmap(year: number | null) {
  const [heatmap, setHeatmap] = useState<ReadingHeatmap | null>(null)

  useEffect(() => {
    if (year === null) {
      setHeatmap(null)
      return undefined
    }

    let cancelled = false

    // A failed load resolves to no grid rather than an error state: StatsView
    // renders the heatmap only when it has one, and the summary above it is
    // already reporting on the same fetch failing.
    apiFetch<ReadingHeatmap>(`/stats/heatmap?year=${year}`)
      .then((data) => {
        if (!cancelled) setHeatmap(data)
      })
      .catch(() => {
        if (!cancelled) setHeatmap(null)
      })

    return () => { cancelled = true }
  }, [year])

  return { heatmap }
}

export default useHeatmap
