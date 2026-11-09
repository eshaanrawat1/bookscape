import { useCallback, useMemo, useState } from 'react'
import { apiFetch } from '../api.js'
import { errorMessage } from '../utils.js'
import { readingGoalYear as year } from '../constants.js'
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
function finishedInYear(books: Book[]): Book[] {
  const prefix = String(year)
  return books
    .filter((book) => book.finish_date.slice(0, 4) === prefix)
    .sort((a, b) => a.finish_date.localeCompare(b.finish_date))
}

// Progress comes from finished books so the bar moves without a round trip; the target loads with the library.
function useReadingGoal(
  finished: Book[],
  target: number,
  setTarget: (target: number) => void,
  loading: boolean,
): ReadingGoalState {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(async (next: number) => {
    const clean = Math.max(0, Math.min(MAX_READING_GOAL, Math.round(next) || 0))
    setSaving(true)
    setError(null)
    try {
      const data = await apiFetch<{ target: number }>('/settings/reading-goal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: clean, year }),
      })
      setTarget(data.target)
    } catch (err) {
      setError(errorMessage(err, 'Could not save your reading goal.'))
      throw err
    } finally {
      setSaving(false)
    }
  }, [setTarget])

  const clear = useCallback(() => save(0), [save])

  const read = useMemo(() => finishedInYear(finished), [finished])

  return { year, target, read, booksRead: read.length, loading, saving, error, save, clear }
}

export { daysPerBook, booksPerYear, MAX_READING_GOAL }
export default useReadingGoal
