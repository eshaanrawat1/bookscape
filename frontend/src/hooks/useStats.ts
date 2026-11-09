import { useMemo, useState } from 'react'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { selectStats } from '../selectors.js'
import type { Book } from '../types.js'

// The page opens on the year you are living in, because that is the one the bar
// chart has something to say about; a library with nothing finished this year
// opens on the most recent year that has books instead.
function initialYear(books: Book[]): string {
  const current = new Date().getFullYear()
  const { booksRead, availableYears } = selectStats(books, current)
  return String(booksRead === 0 && availableYears.length > 0 ? availableYears[0] : current)
}

function useStats() {
  const { books } = useLibraryData()
  // '' is all time.
  const [year, setYear] = useState(() => initialYear(books))
  const summary = useMemo(() => selectStats(books, year ? Number(year) : null), [books, year])
  return { summary, year, setYear }
}

export default useStats
