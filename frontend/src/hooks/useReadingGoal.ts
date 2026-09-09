import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api.js'
import type { Book, ReadingGoalState } from '../types.js'

// A year is 365 days for pacing purposes. The dialog's two fields are a
// conversion of one another ("52 books" is "one every 7 days"), and rounding a
// leap year in would move the answer by less than the rounding already does.
const DAYS_IN_YEAR = 365
const MAX_READING_GOAL = 1000

// How often you would have to finish a book to hit `target` in a year, and back
// again. The pair does not round-trip exactly at the top of the range — 100
// books is a book every 4 days, which is 91 books — so only the field you are
// not typing in is ever recomputed. Converting both ways on every keystroke
// would drag the number you just typed out from under you.
function daysPerBook(target: number): number {
  return target > 0 ? Math.max(1, Math.round(DAYS_IN_YEAR / target)) : 0
}

function booksPerYear(days: number): number {
  return days > 0 ? Math.max(1, Math.min(MAX_READING_GOAL, Math.round(DAYS_IN_YEAR / days))) : 0
}

// The books that count toward the year's goal: everything finished with a date
// in it. Finished-with-no-date is deliberately not counted — the goal is a
// claim about a year, and a book with no finish date cannot be placed in one.
function finishedInYear(books: Book[], year: number): Book[] {
  const prefix = String(year)
  return books
    .filter((book) => book.finishDate.slice(0, 4) === prefix)
    .sort((a, b) => a.finishDate.localeCompare(b.finishDate))
}

// The goal is two halves: the target, which lives in app settings, and the
// progress, which is just the finished books the caller already has. Only the
// target is fetched, so finishing a book moves the bar on the next render
// without a round trip — the same list that feeds the card's covers feeds its
// count.
function useReadingGoal(finished: Book[]): ReadingGoalState {
  // Pinned at mount rather than read per render: it is the key the target is
  // fetched under, and a value that changes on its own would refetch against a
  // year the loaded target does not belong to.
  const [year] = useState(() => new Date().getFullYear())
  const [target, setTarget] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch<{ year?: number; target?: number }>(`/settings/reading-goal?year=${year}`)
      .then((data) => {
        if (!cancelled) setTarget(Math.max(0, Number(data.target) || 0))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your reading goal.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
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
      setError(err instanceof Error ? err.message : 'Could not save your reading goal.')
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
