import { apiFetch } from './api.js'
import type { Book, Collection, RawBookPayload, RawCollection } from './types.js'

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface BootstrapData {
  books: Book[]
  collections: Collection[]
}

async function loadBootstrapData(): Promise<BootstrapData> {
  const [booksRes, collectionsRes] = await Promise.all([
    apiFetch<{ books?: RawBookPayload[] }>('/books'),
    apiFetch<{ collections?: RawCollection[] }>('/collections'),
  ])

  return {
    books: asArray(booksRes?.books).map(normaliseBook),
    collections: mapCollections(collectionsRes?.collections),
  }
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Sliced rather than parsed: new Date('YYYY-MM-DD') is UTC, the previous day west of Greenwich.
function formatDayLabel(iso: string): string {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ''
  return `${MONTH_LABELS[m - 1]} ${d}, ${y}`
}

function mapCollections(rawCollections: RawCollection[] | null | undefined): Collection[] {
  return asArray(rawCollections).map((collection) => ({
    id: String(collection.id),
    name: collection.name,
    icon: collection.icon || '',
    bookIds: asArray(collection.book_ids),
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
  const totalPages = toNumberOrZero(raw.total_pages)
  const currentPage = toNumberOrZero(raw.current_page)
  const genres = asArray(raw.genres).filter(Boolean)

  return {
    id: raw.id || raw.uid || '',
    title: raw.title || 'Untitled',
    author: raw.author || '',
    cover: raw.image_url || '',
    genre: genres[0] || '',
    genres,
    series: raw.series || '',
    seriesNumber: raw.series_number || '',
    pages: toNumberOrZero(raw.page_count) || totalPages,
    totalPages,
    currentPage,
    startDate: raw.start_date || '',
    finishDate: raw.finish_date || '',
    rating: toNumberOrZero(raw.avg_rating),
    reviewCount: toNumberOrZero(raw.review_count),
    ratingCount: toNumberOrZero(raw.rating_count),
    progress: totalPages > 0 ? Math.min(100, Math.round((currentPage / totalPages) * 100)) : 0,
    status: raw.status || 'not_started',
    blurb: raw.description || '',
    similarIds: asArray(raw.similar_book_ids).map(String),
    myRating: toNumberOrZero(raw.my_rating),
    notes: raw.notes || '',
    updatedAt: raw.updated_at || '',
  }
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

// Ids, best match first; the books themselves are already in the library.
async function searchBookIds(query: string, limit: number): Promise<string[]> {
  const clean = String(query || '').trim()
  if (!clean) return []
  const data = await apiFetch<{ ids?: string[] }>(
    `/search?q=${encodeURIComponent(clean)}&limit=${limit}`,
  )
  return asArray(data.ids)
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export {
  sleep,
  errorMessage,
  loadBootstrapData,
  searchBookIds,
  formatDayLabel,
  mapCollections,
  nextCollectionName,
  formatCompactNumber,
  normaliseBook,
  authorViewId,
  authorNameFromView,
  seriesViewId,
  seriesNameFromView,
  genreViewId,
  genreNameFromView,
  booksReadViewId,
  booksReadYearFromView,
}
