import type { LucideIcon } from 'lucide-react'

export type ReadingStatus = 'not_started' | 'reading' | 'done' | 'dnf'

// Shapes vary by endpoint; normaliseBook() is the single place that coerces them into a Book.
export interface RawBookPayload {
  id?: string
  uid?: string
  title?: string
  author?: string
  image_url?: string
  linked_catalog_book?: RawLinkedCatalogBook | null
  genre?: string
  genres?: string[]
  series?: string
  series_number?: string
  page_count?: number
  total_pages?: number
  reading_total_pages?: number
  current_page?: number
  reading_current_page?: number
  start_date?: string
  reading_start_date?: string
  finish_date?: string
  reading_finish_date?: string
  avg_rating?: number | string
  review_count?: number | string
  rating_count?: number | string
  reading_status?: ReadingStatus
  status?: ReadingStatus
  description?: string
  similar_books?: RawBookPayload[]
  [key: string]: unknown
}

type RawLinkedCatalogBook = Pick<
  RawBookPayload,
  'series' | 'series_number' | 'avg_rating' | 'rating_count' | 'review_count' | 'page_count'
>

export interface Book {
  id: string
  title: string
  author: string
  cover: string
  genre: string
  genres: string[]
  // seriesNumber stays text: Goodreads numbers novellas "1.5".
  series: string
  seriesNumber: string
  pages: number
  totalPages: number
  currentPage: number
  startDate: string
  finishDate: string
  rating: number
  reviewCount: number
  ratingCount: number
  progress: number
  status: ReadingStatus
  blurb: string
  _raw: RawBookPayload
  similar_books?: RawBookPayload[]
}

export interface BookProps {
  book: Book
}

export interface CatalogBooks {
  books: Book[]
  loading: boolean
  error: string | null
}

export interface RawList {
  name: string
  icon?: string
  book_ids?: string[]
  books?: RawBookPayload[]
}

export interface Collection {
  id: string
  name: string
  // A lucide name from collectionIcons.ts, or '' for the default dot.
  icon: string
  bookIds: string[]
  books: Book[]
}

export interface GenreSection {
  genre: string
  books: Book[]
}

// `page` is 0 for "no page recorded"; `note` is separate from the per-book notes field.
export interface RawHighlight {
  id: number
  book_id: string
  text: string
  page: number
  note: string
  created_at: string
  updated_at: string
}

export interface Highlight {
  id: number
  bookId: string
  text: string
  page: number
  note: string
  createdAt: string
  updatedAt: string
}

export interface RawHighlightGroup {
  book_id: string
  book: RawBookPayload | null
  count: number
  highlights: RawHighlight[]
}

// Newest first; the backend drops groups whose catalog row is gone, so `book` is always present.
export interface HighlightGroup {
  bookId: string
  book: Book
  count: number
  highlights: Highlight[]
}

export interface RawGenreSection {
  genre: string
  books: RawBookPayload[]
}

// `books` are raw payloads for normaliseBook(); `months` is always twelve entries, January first.
export interface StatsSummary {
  year: number | null
  available_years: number[]
  books_read: number
  pages_read: number
  genres_covered: number
  days_reading: number
  months: number[]
  // Oldest first, including empty years, capped to twelve; only populated for the all-time summary.
  year_counts: YearCount[]
  books: RawBookPayload[]
}

interface YearCount {
  year: number
  count: number
}

// `next_book` is the book in progress, else the first unread; nullable though always set in practice.
export interface SeriesProgress {
  series: string
  total: number
  read: number
  reading: number
  next_book: RawBookPayload | null
}

// `target` is 0 when no goal is set; `read` comes from the client's finished list, not the server.
export interface ReadingGoalState {
  year: number
  target: number
  read: Book[]
  booksRead: number
  loading: boolean
  saving: boolean
  error: string | null
  // Rejects on failure so the dialog can stay open on the typed number.
  save: (target: number) => Promise<void>
  clear: () => Promise<void>
}

export interface LibraryDataContextValue {
  collections: Collection[]
  wantToReadBooks: Book[]
  globalLibrary: GenreSection[]
  currentlyReading: Book[]
  wantToRead: Book[]
  finished: Book[]
  dnf: Book[]
  readingGoal: ReadingGoalState
  booksByIds: (ids: string[]) => Book[]
  // Bumped on each app-level reload; views that fetch their own books watch it to refetch.
  dataVersion: number
  refreshLibrary: () => Promise<void>
  addBookToCollection: (collectionName: string, bookId: string) => Promise<void>
  removeBookFromCollection: (collectionName: string, bookId: string) => Promise<void>
  toggleBookWantToRead: (bookId: string, isSaved: boolean) => Promise<void>
  createCollection: () => Promise<string>
  renameCollection: (collection: Collection, name: string) => Promise<string>
  setCollectionIcon: (collection: Collection, icon: string) => Promise<void>
  deleteCollection: (collection: Collection) => Promise<void>
}

export type ToastTone = 'info' | 'error'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

export interface ToastOptions {
  tone?: ToastTone
  // Toasts sharing a key replace one another instead of stacking.
  key?: string
}

export interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => void
  // A failed action: the thrown message if it has one, else `fallback`.
  showError: (err: unknown, fallback: string, key?: ToastOptions['key']) => void
}

export interface NavigationContextValue {
  onOpen: (book: Book) => void
  onOpenAuthor: (author: string) => void
  onOpenSeries: (series: string) => void
  onOpenGenre: (genre: string) => void
  // The stats page's Books read drilldown. '' is all time, as on the stats page.
  onOpenBooksRead: (year: string) => void
  onOpenWantToRead: () => void
  onEditReadingGoal: () => void
}

export type VaultAction = 'push' | 'pull'

type CommandAction = () => void | Promise<void>

export type CommandGroup = 'Navigate' | 'Actions' | 'Collections'

export interface Command {
  id: string
  label: string
  group: CommandGroup
  icon: LucideIcon
  // Rendered right-aligned on the row, e.g. '⌘1'.
  hint?: string
  // Extra text folded into fuzzy matching but never shown.
  keywords?: string
  run: CommandAction
}

export interface CommandDeps {
  collections: Collection[]
  vaultBusy: VaultAction | null
  goTo: (viewId: string) => void
  onAddBook: () => void
  onNewCollection: CommandAction
  onRefresh: CommandAction
  onVaultSettings: () => void
  onPush: CommandAction
  onPull: CommandAction
}
