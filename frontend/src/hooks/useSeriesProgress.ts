import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import type { SeriesProgress } from '../types.js'

// The shelf's whole point is being current: finishing the book you were on is
// what moves a series along, and that edit happens in the dialog. So this reads
// `dataVersion` for the same reason the catalog drilldowns do — a shelf still
// saying "2 of 3" after you marked the third one done is worse than no shelf.
//
// A failed load resolves to an empty list rather than an error state. This is a
// secondary shelf on a page that has plenty else to show, and Shelf already
// renders nothing when it has no books; an error banner over Reading Now would
// be louder than what it is reporting.
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
