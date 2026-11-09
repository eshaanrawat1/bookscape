import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import type { SeriesProgress } from '../types.js'

// Reads dataVersion to stay current; a failed load is an empty list, so Shelf renders nothing.
function useSeriesProgress() {
  const { dataVersion } = useLibraryData()
  const [series, setSeries] = useState<SeriesProgress[]>([])

  useEffect(() => {
    let cancelled = false

    apiFetch<{ series?: SeriesProgress[] }>('/series-progress')
      .then((data) => {
        if (!cancelled) setSeries(data.series || [])
      })
      .catch(() => {
        if (!cancelled) setSeries([])
      })

    return () => { cancelled = true }
  }, [dataVersion])

  return series
}

export default useSeriesProgress
