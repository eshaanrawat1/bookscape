import { apiFetch } from './api.js'
import type { Book, Collection, GenreSection, RawBookPayload, RawGenreSection, RawList } from './types.js'

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface BootstrapData {
  books: RawBookPayload[]
  lists: RawList[]
  wantToReadBooks: RawBookPayload[]
  globalLibrary: GenreSection[]
}

async function loadBootstrapData(): Promise<BootstrapData> {
  const [myBooksRes, listsRes, wantToReadRes, globalRes] = await Promise.all([
    apiFetch<{ books?: RawBookPayload[] }>('/my-books'),
    apiFetch<{ lists?: RawList[] }>('/reading-lists'),
    apiFetch<{ books?: RawBookPayload[] }>('/want-to-read-books'),
    apiFetch<{ genres?: RawGenreSection[] }>('/global-library'),
  ])

  return {
    books: asArray(myBooksRes?.books),
    lists: asArray(listsRes?.lists),
    wantToReadBooks: asArray(wantToReadRes?.books),
    // Normalised like every other list, or these books open the tracking panel with 0/0 pages.
    globalLibrary: asArray(globalRes?.genres).map((section) => ({
      genre: section.genre,
      books: asArray(section.books).map(normaliseBook),
    })),
  }
}

function collectionIdFromName(name: string): string {
  return encodeURIComponent(name)
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Sliced rather than parsed: new Date('YYYY-MM-DD') is UTC, the previous day west of Greenwich.
function formatDayLabel(iso: string): string {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ''
  return `${MONTH_LABELS[m - 1]} ${d}, ${y}`
}

function mapReadingLists(rawLists: RawList[]): Collection[] {
  return rawLists.map((list) => ({
    id: collectionIdFromName(list.name),
    name: list.name,
    icon: list.icon || '',
    bookIds: (list.book_ids || []),
    books: (list.books || []).map(normaliseBook),
  }))
}

function nextCollectionName(collections: Collection[]): string {
  const existing = new Set(collections.map((collection) => collection.name.trim().toLowerCase()))
  let index = 1
  while (existing.has(`collection ${index}`)) index += 1
  return `Collection ${index}`
}

function formatCompactNumber(value: number | string): string {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return '0'
  const compact = (divisor: number, suffix: string) => {
    const truncated = Math.floor((num / divisor) * 10) / 10
    const text = truncated % 1 === 0 ? String(truncated.toFixed(0)) : String(truncated.toFixed(1))
    return `${text}${suffix}`
  }
  if (num >= 1_000_000_000) return compact(1_000_000_000, 'B')
  if (num >= 1_000_000) return compact(1_000_000, 'M')
  if (num >= 1_000) return compact(1_000, 'K')
  return `${Math.round(num)}`
}

function toNumberOrZero(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normaliseBook(raw: RawBookPayload): Book {
  const totalPages = toNumberOrZero(raw.reading_total_pages ?? raw.total_pages)
  const currentPage = toNumberOrZero(raw.reading_current_page ?? raw.current_page)
  const progress =
    totalPages > 0 ? Math.min(100, Math.round((currentPage / totalPages) * 100)) : 0

  const status = raw.reading_status || raw.status || 'not_started'
  const genres = Array.isArray(raw.genres) ? raw.genres.filter(Boolean) : []
  const primaryGenre = raw.genre || genres[0] || ''
  // /my-books nests catalog stats under linked_catalog_book, so those fields fall back through it.
  const catalog = raw.linked_catalog_book || {}
  const rating = parseFloat(String(raw.avg_rating ?? catalog.avg_rating ?? '')) || 0
  const pages = raw.page_count || raw.total_pages || raw.reading_total_pages || totalPages || catalog.page_count || 0
  const reviewCount = parseInt(String(raw.review_count ?? catalog.review_count ?? 0), 10) || 0
  const ratingCount = parseInt(String(raw.rating_count ?? catalog.rating_count ?? 0), 10) || 0

  return {
    id: raw.id || raw.uid || '',
    title: raw.title || 'Untitled',
    author: raw.author || '',
    cover: raw.image_url || '',
    genre: primaryGenre,
    genres,
    series: raw.series || raw.linked_catalog_book?.series || '',
    seriesNumber: raw.series_number || raw.linked_catalog_book?.series_number || '',
    pages,
    totalPages,
    currentPage,
    startDate: raw.reading_start_date || raw.start_date || '',
    finishDate: raw.reading_finish_date || raw.finish_date || '',
    rating,
    reviewCount,
    ratingCount,
    progress,
    status,
    blurb: raw.description || '',
    _raw: raw,
  }
}

function getCatalogBookId(book?: Book | RawBookPayload | null): string {
  if (!book) return ''
  const raw: RawBookPayload = '_raw' in book ? (book as Book)._raw : (book as RawBookPayload)
  return String(raw.uid || raw.id || '').trim() || ''
}

function resolveSavedWantToReadBook(book: Book, savedBooks: Book[] | null | undefined): Book | null {
  const targetId = getCatalogBookId(book)
  if (!targetId) return null
  return (savedBooks || []).find((savedBook) => getCatalogBookId(savedBook) === targetId) || null
}

function authorViewId(author: string): string {
  return `author:${encodeURIComponent(String(author || '').trim())}`
}

function authorNameFromView(view: string): string {
  if (!String(view || '').startsWith('author:')) return ''
  const raw = String(view).slice('author:'.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function seriesViewId(series: string): string {
  return `series:${encodeURIComponent(String(series || '').trim())}`
}

function seriesNameFromView(view: string): string {
  if (!String(view || '').startsWith('series:')) return ''
  const raw = String(view).slice('series:'.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function genreViewId(genre: string): string {
  return `genre:${encodeURIComponent(String(genre || '').trim())}`
}

function genreNameFromView(view: string): string {
  if (!String(view || '').startsWith('genre:')) return ''
  const raw = String(view).slice('genre:'.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

// '' (all time) becomes 'all' so the view id isn't a bare prefix.
function booksReadViewId(year: string): string {
  return `books-read:${String(year || '').trim() || 'all'}`
}

function booksReadYearFromView(view: string): string {
  if (!String(view || '').startsWith('books-read:')) return ''
  const raw = String(view).slice('books-read:'.length)
  return raw === 'all' ? '' : raw
}

// The backend clamps limit to 50 and searches the whole catalog, not just owned books.
async function searchBooks(query: string, limit: number): Promise<Book[]> {
  const clean = String(query || '').trim()
  if (!clean) return []
  const data = await apiFetch<{ results?: RawBookPayload[] }>(
    `/search?q=${encodeURIComponent(clean)}&limit=${limit}`,
  )
  return (data.results || []).map(normaliseBook)
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export {
  sleep,
  errorMessage,
  loadBootstrapData,
  searchBooks,
  collectionIdFromName,
  formatDayLabel,
  mapReadingLists,
  nextCollectionName,
  formatCompactNumber,
  normaliseBook,
  getCatalogBookId,
  resolveSavedWantToReadBook,
  authorViewId,
  authorNameFromView,
  seriesViewId,
  seriesNameFromView,
  genreViewId,
  genreNameFromView,
  booksReadViewId,
  booksReadYearFromView,
}
