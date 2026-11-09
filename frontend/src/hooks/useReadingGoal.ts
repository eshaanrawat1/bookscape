import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch, BOOTSTRAP_RETRIES, BOOTSTRAP_RETRY_DELAY_MS } from '../api.js'
import { sleep, errorMessage } from '../utils.js'
import type { Book, ReadingGoalState } from '../types.js'

const DAYS_IN_YEAR = 365
const MAX_READING_GOAL = 1000

// Not an exact round-trip (100 books -> every 4 days -> 91), so only the other field is recomputed.
function daysPerBook(target: number): number {
  return target > 0 ? Math.max(1, Math.round(DAYS_IN_YEAR / target)) : 0
}

function booksPerYear(days: number): number {
  return days > 0 ? Math.max(1, Math.min(MAX_READING_GOAL, Math.round(DAYS_IN_YEAR / days))) : 0
}

// Undated finishes don't count: a book with no finish date can't be placed in a year.
function finishedInYear(books: Book[], year: number): Book[] {
  const prefix = String(year)
  return books
    .filter((book) => book.finishDate.slice(0, 4) === prefix)
    .sort((a, b) => a.finishDate.localeCompare(b.finishDate))
}

// Only the target is fetched; progress comes from finished books so the bar moves without a round trip.
function useReadingGoal(finished: Book[]): ReadingGoalState {
  // Pinned at mount: it keys the fetched target, so it must not change on its own.
  const [year] = useState(() => new Date().getFullYear())
  const [target, setTarget] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Retried like App's bootstrap: this races the same cold start, and a refusal would read as "no goal".
  useEffect(() => {
    let cancelled = false

    async function load() {
      for (let attempt = 0; attempt <= BOOTSTRAP_RETRIES; attempt += 1) {
        try {
          const data = await apiFetch<{ year?: number; target?: number }>(
            `/settings/reading-goal?year=${year}`,
          )
          if (cancelled) return
          setTarget(Math.max(0, Number(data.target) || 0))
          setError(null)
          setLoading(false)
          return
        } catch (err) {
          if (cancelled) return
          if (attempt < BOOTSTRAP_RETRIES) {
            await sleep(BOOTSTRAP_RETRY_DELAY_MS)
            if (cancelled) return
            continue
          }
          setError(errorMessage(err, 'Could not load your reading goal.'))
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [year])

  const save = useCallback(async (next: number) => {
    const clean = Math.max(0, Math.min(MAX_READING_GOAL, Math.round(next) || 0))
    setSaving(true)
    setError(null)
    try {
      const data = await apiFetch<{ target?: number }>('/settings/reading-goal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: clean, year }),
      })
      setTarget(Math.max(0, Number(data.target) || 0))
    } catch (err) {
      setError(errorMessage(err, 'Could not save your reading goal.'))
      throw err
    } finally {
      setSaving(false)
    }
  }, [year])

  const clear = useCallback(() => save(0), [save])

  const read = useMemo(() => finishedInYear(finished, year), [finished, year])

  return { year, target, read, booksRead: read.length, loading, saving, error, save, clear }
}

export { daysPerBook, booksPerYear, MAX_READING_GOAL }
export default useReadingGoal
