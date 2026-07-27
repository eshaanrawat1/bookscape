import { apiFetch } from './api.js'

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadBootstrapData() {
  const [myBooksRes, listsRes, wantToReadRes, globalRes] = await Promise.all([
    apiFetch('/my-books'),
    apiFetch('/reading-lists'),
    apiFetch('/want-to-read-books'),
    apiFetch('/global-library'),
  ])

  return {
    books: asArray(myBooksRes?.books),
    lists: asArray(listsRes?.lists),
    wantToReadBooks: asArray(wantToReadRes?.books),
    globalLibrary: asArray(globalRes?.genres),
  }
}

function collectionIdFromName(name) {
  return encodeURIComponent(name)
}

function mapReadingLists(rawLists) {
  return rawLists.map((list) => ({
    id: collectionIdFromName(list.name),
    name: list.name,
    description: '',
    bookIds: (list.book_ids || []),
    books: (list.books || []).map(normaliseBook),
  }))
}

function nextCollectionName(collections) {
  const existing = new Set(collections.map((collection) => collection.name.trim().toLowerCase()))
  let index = 1
  while (existing.has(`collection ${index}`)) index += 1
  return `Collection ${index}`
}

function formatCompactNumber(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return '0'
  const compact = (divisor, suffix) => {
    const truncated = Math.floor((Math.abs(num) / divisor) * 10) / 10
    const text = truncated % 1 === 0 ? String(truncated.toFixed(0)) : String(truncated.toFixed(1))
    return `${num < 0 ? '-' : ''}${text}${suffix}`
  }
  if (num >= 1_000_000_000) return compact(1_000_000_000, 'B')
  if (num >= 1_000_000) return compact(1_000_000, 'M')
  if (num >= 1_000) return compact(1_000, 'K')
  return `${Math.round(num)}`
}

function toNumberOrZero(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normaliseBook(raw) {
  const totalPages = toNumberOrZero(raw.reading_total_pages ?? raw.total_pages)
  const currentPage = toNumberOrZero(raw.reading_current_page ?? raw.current_page)
  const progress =
    totalPages > 0 ? Math.min(100, Math.round((currentPage / totalPages) * 100)) : 0

  const status = raw.reading_status || raw.status || 'not_started'
  const genres = Array.isArray(raw.genres) ? raw.genres.filter(Boolean) : []
  const primaryGenre = raw.genre || genres[0] || ''
  const rating = parseFloat(raw.avg_rating ?? raw.book_rating) || 0
  const pages = raw.page_count || raw.total_pages || raw.reading_total_pages || totalPages
  const reviewCount = parseInt(raw.review_count ?? raw.book_review_count ?? 0, 10) || 0
  const ratingCount = parseInt(raw.rating_count ?? raw.book_rating_count ?? 0, 10) || 0

  return {
    id: raw.id || raw.uid || '',
    title: raw.title || 'Untitled',
    author: raw.author || '',
    cover: raw.cover || raw.image_url || '',
    color: raw.color || raw.linked_catalog_book?.color || '',
    tint: '220 30% 45%', // neutral fallback tint — image_url is used for actual cover art
    genre: primaryGenre,
    genres,
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
    format: [], // not tracked in our dataset; omit audio badge
    blurb: raw.description || '',
    // keep raw fields for completeness
    _raw: raw,
  }
}

function getCatalogBookId(book) {
  const raw = book?._raw || book || {}
  return String(raw.uid || raw.id || '').trim() || ''
}

function resolveSavedWantToReadBook(book, savedBooks) {
  const targetId = getCatalogBookId(book)
  if (!targetId) return null
  return (savedBooks || []).find((savedBook) => getCatalogBookId(savedBook) === targetId) || null
}

function authorViewId(author) {
  return `author:${encodeURIComponent(String(author || '').trim())}`
}

function authorNameFromView(view) {
  if (!String(view || '').startsWith('author:')) return ''
  const raw = String(view).slice('author:'.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function genreViewId(genre) {
  return `genre:${encodeURIComponent(String(genre || '').trim())}`
}

function genreNameFromView(view) {
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
  genreViewId,
  genreNameFromView,
}
