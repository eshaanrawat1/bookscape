import type { LucideIcon } from 'lucide-react'

export type ReadingStatus = 'not_started' | 'reading' | 'done' | 'dnf'

// Raw payload shapes vary across endpoints (/my-books, /global-library, /search,
// /author-books, /genre-books, /book/{id}); normaliseBook() is the single place
// that coerces whichever fields are present into a Book.
export interface RawBookPayload {
  id?: string
  uid?: string
  title?: string
  author?: string
  image_url?: string
  color?: string
  linked_catalog_book?: {
    color?: string
    series?: string
    series_number?: string
    avg_rating?: number | string
    rating_count?: number | string
    review_count?: number | string
    page_count?: number
  } | null
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

export interface Book {
  id: string
  title: string
  author: string
  cover: string
  color: string
  genre: string
  genres: string[]
  // Kept as two fields rather than one pre-joined "Name #2" string: the name is
  // the identity a series is looked up by, and seriesNumber stays text because
  // Goodreads numbers novellas "1.5" — parsing it to a number would lose that.
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

export interface RawList {
  name: string
  book_ids?: string[]
  books?: RawBookPayload[]
}

export interface Collection {
  id: string
  name: string
  description: string
  bookIds: string[]
  books: Book[]
}

export interface GenreSection {
  genre: string
  books: Book[]
}

export interface RawGenreSection {
  genre: string
  books: RawBookPayload[]
}

// One carousel card: a superlative, the number that earned it, and the book that
// won. The backend picks these and never repeats a book across cards, so the
// list is already display-ready and can be shorter than the six specs.
//
// `book` is a raw payload like every other endpoint's, not a Book: the card runs
// it through normaliseBook() so this page builds a book exactly the way the rest
// of the app does, rather than trusting a second hand-rolled shape.
export interface FeaturedStat {
  key: string
  label: string
  value: number
  unit: string
  book: RawBookPayload
}

export interface StatsSummary {
  available_years: number[]
  books_read: number
  pages_read: number
  genres_covered: number
  genre_list: string[]
  densest_book: RawBookPayload | null
  most_time_spent: RawBookPayload | null
  most_time_spent_days: number
  featured: FeaturedStat[]
}

export interface HeatmapDay {
  date: string
  pages: number
  books: number
  book_ids: string[]
  level: number
}

// Only days with reading are listed — the grid's empty cells are filled in from
// start/end, so a year does not ship ~370 mostly-zero objects.
export interface ReadingHeatmap {
  start: string
  end: string
  year: number | null
  days: HeatmapDay[]
  thresholds: number[]
  levels: number
  total_pages: number
  days_read: number
  best_day: HeatmapDay | null
  streak: { current: number; longest: number }
}

export interface SyncPullResult {
  ok: boolean
  dry_run: boolean
  vault_path: string
  scanned_files: number
  imported: number
  skipped: string[]
}

export interface SyncPushResult {
  ok: boolean
  dry_run: boolean
  vault_path: string
  written: number
  deleted: number
  skipped_collisions: { filename: string; uids: string[] }[]
}

export interface LibraryDataContextValue {
  collections: Collection[]
  wantToReadBooks: Book[]
  globalLibrary: GenreSection[]
  currentlyReading: Book[]
  wantToRead: Book[]
  finished: Book[]
  booksByIds: (ids: string[]) => Book[]
  // Bumped every time the app-level lists are reloaded. Views that fetch their
  // own books (the author, series and genre drilldowns, and search) watch it so
  // an edit made in the dialog reaches them too — the context lists refresh
  // themselves, but those pages own their results and would otherwise go stale.
  dataVersion: number
  refreshLibrary: () => Promise<void>
  addBookToCollection: (collectionName: string, bookId: string) => Promise<void>
  removeBookFromCollection: (collectionName: string, bookId: string) => Promise<void>
  toggleBookWantToRead: (bookId: string, isSaved: boolean) => Promise<void>
  createCollection: () => Promise<string>
  renameCollection: (collection: Collection, name: string) => Promise<string>
  deleteCollection: (collection: Collection) => Promise<void>
}

// Confirmations and action errors, shown in one fixed corner stack rather than
// inline in whatever dialog fired them — a message about a save that closes
// with the dialog is a message nobody reads.
export type ToastTone = 'info' | 'error'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
}

export interface ToastOptions {
  tone?: ToastTone
  // Toasts sharing a key replace one another instead of stacking. Every action
  // that can be repeated on the same target passes one — without it, flipping a
  // book in and out of Want to read four times leaves four toasts on screen
  // saying contradictory things.
  key?: string
}

export interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => void
}

export interface NavigationContextValue {
  onOpen: (book: Book) => void
  onOpenAuthor: (author: string) => void
  onOpenSeries: (series: string) => void
  onOpenGenre: (genre: string) => void
  onOpenWantToRead: () => void
  // Generic jump to any view id — 'library', 'collection:foo', 'genre:Sci-Fi'.
  // Descendants otherwise have no way to reach App's `view` state.
  goTo: (viewId: string) => void
}

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
  run: () => void | Promise<void>
}

export interface CommandDeps {
  collections: Collection[]
  vaultBusy: 'push' | 'pull' | null
  goTo: (viewId: string) => void
  onAddBook: () => void
  onNewCollection: () => void | Promise<void>
  onRefresh: () => void | Promise<void>
  onVaultSettings: () => void
  onPush: () => void | Promise<void>
  onPull: () => void | Promise<void>
}
