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
    // Every other list normalises on the way in; the shelves on the Library
    // page are the one place that used to hand the backend's raw rows straight
    // to the cards. That left `pages`/`totalPages` undefined on those books, so
    // opening one and switching to My Reading seeded the tracking panel with
    // 0/0 instead of the catalog's page count.
    globalLibrary: asArray(globalRes?.genres).map((section) => ({
      genre: section.genre,
      books: asArray(section.books).map(normaliseBook),
    })),
  }
}

function collectionIdFromName(name: string): string {
  return encodeURIComponent(name)
}

function mapReadingLists(rawLists: RawList[]): Collection[] {
  return rawLists.map((list) => ({
    id: collectionIdFromName(list.name),
    name: list.name,
    description: '',
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
    const truncated = Math.floor((Math.abs(num) / divisor) * 10) / 10
    const text = truncated % 1 === 0 ? String(truncated.toFixed(0)) : String(truncated.toFixed(1))
    return `${num < 0 ? '-' : ''}${text}${suffix}`
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
  // /my-books is built around the reading row and carries none of the catalog's
  // review stats at the top level — only nested under `linked_catalog_book`, the
  // same reason `color` and `series` fall back the way they do. Without these
  // fallbacks a finished or in-progress book opened its About tab with no
  // rating and no review count, while the very same book showed both in Library.
  const catalog = raw.linked_catalog_book || {}
  const rating = parseFloat(String(raw.avg_rating ?? raw.book_rating ?? catalog.avg_rating ?? '')) || 0
  const pages = raw.page_count || raw.total_pages || raw.reading_total_pages || totalPages || catalog.page_count || 0
  const reviewCount = parseInt(String(raw.review_count ?? catalog.review_count ?? 0), 10) || 0
  const ratingCount = parseInt(String(raw.rating_count ?? catalog.rating_count ?? 0), 10) || 0

  return {
    id: raw.id || raw.uid || '',
    title: raw.title || 'Untitled',
    author: raw.author || '',
    cover: raw.cover || raw.image_url || '',
    color: raw.color || raw.linked_catalog_book?.color || '',
    tint: '220 30% 45%', // neutral fallback tint — image_url is used for actual cover art
    genre: primaryGenre,
    genres,
    // /my-books nests the catalog row under linked_catalog_book, the same
    // reason `color` falls back the same way.
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
    // keep raw fields for completeness
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

export {
  sleep,
  loadBootstrapData,
  collectionIdFromName,
  mapReadingLists,
  nextCollectionName,
  formatCompactNumber,
  toNumberOrZero,
  normaliseBook,
  getCatalogBookId,
  resolveSavedWantToReadBook,
  authorViewId,
  authorNameFromView,
  seriesViewId,
  seriesNameFromView,
  genreViewId,
  genreNameFromView,
}
