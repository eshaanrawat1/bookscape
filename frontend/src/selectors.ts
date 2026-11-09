import type { Book, GenreSection, SeriesProgress, StatsSummary } from './types.js'

// Every page is a filter and sort over the one list of books the app holds.

// Binary comparison, not localeCompare: these order ISO dates and numeric ids.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function isUntouched(book: Book): boolean {
  return book.status === 'not_started' || book.status === 'want'
}

// ---- Shelves ----

function newestFirst(a: Book, b: Book): number {
  return compare(b.finish_date, a.finish_date)
    || compare(b.start_date, a.start_date)
    || compare(b.title, a.title)
}

function selectShelves(books: Book[]) {
  const withStatus = (status: Book['status']) => books.filter((book) => book.status === status).sort(newestFirst)
  return {
    currentlyReading: withStatus('reading'),
    // In the order they were saved: changing a book's status stamps updatedAt.
    wantToRead: books
      .filter((book) => book.status === 'want')
      .sort((a, b) => compare(a.updated_at, b.updated_at)),
    finished: withStatus('done'),
    dnf: withStatus('dnf'),
  }
}

// ---- Library and genre pages ----

const LIBRARY_GENRES = [
  'Romantasy', 'Romance', 'Classics', 'Fantasy', 'High Fantasy', 'Dark Academia', 'Science Fiction',
  'Historical Fiction', 'Mystery', 'Thriller', 'Nonfiction', 'Philosophy', 'Psychology',
]
const LIBRARY_SHELF_SIZE = 30
const GENRE_PAGE_SIZE = 100

function mostRatedFirst(a: Book, b: Book): number {
  return b.rating_count - a.rating_count
}

function selectLibrarySections(books: Book[]): GenreSection[] {
  if (!books.length) return []
  return LIBRARY_GENRES.map((genre) => ({
    genre,
    books: books
      .filter((book) => book.genres.includes(genre))
      .sort(mostRatedFirst)
      .slice(0, LIBRARY_SHELF_SIZE),
  }))
}

function selectGenreBooks(books: Book[], genre: string): Book[] {
  const query = genre.trim().toLowerCase()
  if (!query) return []
  return books
    .filter((book) => book.genres.some((name) => name.toLowerCase() === query))
    .sort(mostRatedFirst)
    .slice(0, GENRE_PAGE_SIZE)
}

// ---- Author page ----

function normaliseName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

function splitAuthors(value: string): string[] {
  return value.split(/\s+(?:&|and|with|x)\s+|[;/]/i).map((part) => part.trim()).filter(Boolean)
}

function selectAuthorBooks(books: Book[], author: string): Book[] {
  const query = normaliseName(author)
  if (!query) return []
  return books
    .filter((book) =>
      [book.author, ...splitAuthors(book.author).map(normaliseName)]
        .some((name) => name && (name === query || name.includes(query) || query.includes(name))))
    .sort((a, b) => compare(a.title.toLowerCase(), b.title.toLowerCase()) || compare(a.id, b.id))
}

// ---- Series ----

// Goodreads numbers novellas "1.5", so the number is parsed rather than sorted as
// text. Anything unparseable (an omnibus "1-3", a prequel with no number) goes to
// the end rather than displacing book one.
function seriesPosition(book: Book): number {
  const raw = book.series_number.trim()
  const parsed = raw ? Number(raw) : NaN
  return Number.isNaN(parsed) ? Infinity : parsed
}

function inSeriesOrder(a: Book, b: Book): number {
  const [left, right] = [seriesPosition(a), seriesPosition(b)]
  return (left === right ? 0 : left - right) || compare(a.title.toLowerCase(), b.title.toLowerCase())
}

function selectSeriesBooks(books: Book[], series: string): Book[] {
  const query = series.trim().toLowerCase()
  if (!query) return []
  return books.filter((book) => book.series.toLowerCase() === query).sort(inSeriesOrder)
}

// A series you are partway through: at least one book read or being read, and at
// least one neither finished nor abandoned. One-book "series" have no reading
// order to be partway through.
function selectSeriesProgress(books: Book[]): SeriesProgress[] {
  const groups = new Map<string, Book[]>()
  for (const book of books) {
    const key = book.series.trim().toLowerCase()
    if (key) groups.set(key, [...(groups.get(key) || []), book])
  }

  const progress: SeriesProgress[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    group.sort(inSeriesOrder)
    const count = (status: Book['status']) => group.filter((book) => book.status === status).length
    const [read, reading, dnf] = [count('done'), count('reading'), count('dnf')]
    if (read + reading === 0 || read + dnf === group.length) continue
    progress.push({
      series: group[0].series.trim(),
      total: group.length,
      read,
      reading,
      dnf,
      // The book in your hands, else the first you have not settled either way.
      nextBook: group.find((book) => book.status === 'reading') || group.find(isUntouched) || null,
    })
  }

  // A series you are actively reading first, then by how little is left.
  return progress.sort((a, b) =>
    Number(b.reading > 0) - Number(a.reading > 0)
    || (a.total - a.read - a.dnf) - (b.total - b.read - b.dnf)
    || compare(a.series.toLowerCase(), b.series.toLowerCase()))
}

// ---- Suggested ----

const SUGGESTION_LIMIT = 20
const SUGGESTION_SOURCES = 8
const SUGGESTIONS_PER_SOURCE = 4

// Taken in turns from the similar-books lists of what you most recently finished,
// so one book cannot fill the row. Want to read stays eligible: seeing a saved
// book again is a reminder, not a repeat.
function selectSuggestedBooks(books: Book[]): Book[] {
  const byId = new Map(books.map((book) => [book.id, book]))
  const settled = (id: string) => ['done', 'reading', 'dnf'].includes(byId.get(id)?.status || '')
  const pools = books
    .filter((book) => book.status === 'done' && book.finish_date.trim())
    .sort((a, b) => compare(b.finish_date, a.finish_date) || compare(b.id, a.id))
    .slice(0, SUGGESTION_SOURCES)
    .map((book) => book.similar_book_ids.filter((id) => byId.has(id) && !settled(id)))

  const picked = new Set<string>()
  for (let round = 0; round < SUGGESTIONS_PER_SOURCE && picked.size < SUGGESTION_LIMIT; round += 1) {
    for (const pool of pools) {
      if (picked.size >= SUGGESTION_LIMIT) break
      const next = pool.find((id) => !picked.has(id))
      if (next) picked.add(next)
    }
  }
  return [...picked].map((id) => byId.get(id) as Book)
}

// ---- Stats ----

const DAY_MS = 86_400_000
// The same column count the month view draws, so the all-time chart keeps its
// shape rather than growing a column per year read.
const YEAR_SPAN = 12

// Whole days since the epoch, or null for anything that is not a real date.
function isoDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim().slice(0, 10))
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return valid ? date.getTime() / DAY_MS : null
}

function finishYear(book: Book): number {
  return Number(book.finish_date.trim().slice(0, 4))
}

// A union rather than a sum of per-book spans: two books read side by side over
// the same fortnight is a fortnight of reading, not a month of it.
function countDaysReading(books: Book[]): number {
  const days = new Set<number>()
  for (const book of books) {
    const start = isoDay(book.start_date)
    const finish = isoDay(book.finish_date)
    if (start === null || finish === null) continue
    for (let day = start; day <= finish; day += 1) days.add(day)
  }
  return days.size
}

// A contiguous run rather than only the years with books, so a year off reads as
// a gap instead of closing up.
function countByYear(books: Book[]) {
  const counts = new Map<number, number>()
  for (const book of books) counts.set(finishYear(book), (counts.get(finishYear(book)) || 0) + 1)
  if (!counts.size) return []
  const newest = Math.max(...counts.keys())
  const oldest = Math.max(Math.min(...counts.keys()), newest - YEAR_SPAN + 1)
  return Array.from({ length: newest - oldest + 1 }, (_, index) => ({
    year: oldest + index,
    count: counts.get(oldest + index) || 0,
  }))
}

function selectStats(books: Book[], year: number | null): StatsSummary {
  const finished = books
    .filter((book) => book.status === 'done' && isoDay(book.finish_date) !== null)
    .filter((book) => year === null || finishYear(book) === year)
    .sort((a, b) => compare(a.finish_date, b.finish_date) || compare(a.title, b.title))

  const months = Array<number>(12).fill(0)
  for (const book of finished) months[Number(book.finish_date.trim().slice(5, 7)) - 1] += 1

  return {
    availableYears: [...new Set(books.filter((book) => isoDay(book.finish_date) !== null).map(finishYear))]
      .sort((a, b) => b - a),
    booksRead: finished.length,
    pagesRead: finished.reduce((sum, book) => sum + book.total_pages, 0),
    genresCovered: new Set(finished.flatMap((book) => book.genres)).size,
    daysReading: countDaysReading(finished),
    months,
    // Empty for a single year: that view is drawn month by month.
    yearCounts: year === null ? countByYear(finished) : [],
    books: finished,
  }
}

export {
  selectShelves,
  selectLibrarySections,
  selectGenreBooks,
  selectAuthorBooks,
  selectSeriesBooks,
  selectSeriesProgress,
  selectSuggestedBooks,
  selectStats,
}
