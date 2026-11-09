import { apiFetch } from './api.js'
import { monthLabels, readingGoalYear } from './constants.js'
import type { Book, Collection, DrilldownKind } from './types.js'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadBootstrapData() {
  const [{ books }, { collections }, { target }] = await Promise.all([
    apiFetch<{ books: Book[] }>('/books'),
    apiFetch<{ collections: Collection[] }>('/collections'),
    apiFetch<{ target: number }>(`/settings/reading-goal?year=${readingGoalYear}`),
  ])
  return { books, collections, goalTarget: target }
}

// Sliced rather than parsed: new Date('YYYY-MM-DD') is UTC, the previous day west of Greenwich.
function formatDayLabel(iso: string): string {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ''
  return `${monthLabels[m - 1]} ${d}, ${y}`
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

function bookMeta(book: Book): string {
  const parts: string[] = []
  if (book.genres[0]) parts.push(book.genres[0])
  if (book.total_pages) parts.push(`${formatCompactNumber(book.total_pages)} pages`)
  return parts.join(' · ')
}

function drilldownView(kind: DrilldownKind, value: string): string {
  return `${kind}:${encodeURIComponent(value.trim())}`
}

function drilldownValue(view: string): string {
  const raw = view.slice(view.indexOf(':') + 1)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

// Ids, best match first; the books themselves are already in the library.
async function searchBookIds(query: string, limit: number): Promise<string[]> {
  const clean = String(query || '').trim()
  if (!clean) return []
  const data = await apiFetch<{ ids: string[] }>(
    `/search?q=${encodeURIComponent(clean)}&limit=${limit}`,
  )
  return data.ids
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
  nextCollectionName,
  formatCompactNumber,
  bookMeta,
  drilldownView,
  drilldownValue,
}
