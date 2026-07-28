import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'

function useStats() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadStats() {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (year) params.set('year', year)
        if (month) params.set('month', month)
        const suffix = params.toString() ? `?${params.toString()}` : ''
        const data = await apiFetch(`/stats${suffix}`)
        if (cancelled) return
        setSummary(data)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load stats.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadStats()
    return () => { cancelled = true }
  }, [year, month])

  return { summary, loading, error, year, month, setYear, setMonth }
}

export default useStats
