import type { LucideIcon } from 'lucide-react'

export type ReadingStatus = 'not_started' | 'want' | 'reading' | 'done' | 'dnf'

// Exactly what the API sends, so a field has one name from the column to the component.
export interface Book {
  id: string
  title: string
  author: string
  image_url: string
  description: string
  avg_rating: number
  rating_count: number
  review_count: number
  series: string
  // Stays text: Goodreads numbers novellas "1.5".
  series_number: string
  genres: string[]
  similar_book_ids: string[]
  status: ReadingStatus
  current_page: number
  // Your edition's length when it differs, otherwise the catalog's.
  total_pages: number
  start_date: string
  finish_date: string
  // 0 is "not rated yet", as on the server.
  my_rating: number
  notes: string
  updated_at: string
}

export interface BookProps {
  book: Book
}

export interface Collection {
  id: number
  name: string
  // A lucide name from collectionIcons.ts, or '' for the default dot.
  icon: string
  book_ids: string[]
}

export interface GenreSection {
  genre: string
  books: Book[]
}

// `page` is 0 for "no page recorded"; `note` is separate from the per-book notes field.
export interface Highlight {
  id: number
  book_id: string
  text: string
  page: number
  note: string
  created_at: string
}

// Newest-highlighted book first.
export interface HighlightGroup {
  book: Book
  highlights: Highlight[]
}

// `months` is always twelve entries, January first.
export interface StatsSummary {
  availableYears: number[]
  booksRead: number
  pagesRead: number
  genresCovered: number
  daysReading: number
  months: number[]
  // Oldest first, including empty years, capped to twelve. Only set for all time.
  yearCounts: YearCount[]
  books: Book[]
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
  dnf: number
  nextBook: Book | null
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
  // Every book in the catalog, each carrying your reading state. All the pages
  // below are derived from this one list, so an edit reaches them all at once.
  books: Book[]
  collections: Collection[]
  currentlyReading: Book[]
  wantToRead: Book[]
  finished: Book[]
  dnf: Book[]
  readingGoal: ReadingGoalState
  booksByIds: (ids: string[]) => Book[]
  // Puts one changed book into the list, or adds it if it is new.
  applyBook: (book: Book) => void
  addBookToCollection: (collectionId: number, bookId: string) => Promise<void>
  removeBookFromCollection: (collectionId: number, bookId: string) => Promise<void>
  createCollection: () => Promise<Collection | undefined>
  updateCollection: (collectionId: number, fields: { name?: string; icon?: string }) => Promise<void>
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

export type DrilldownKind = 'author' | 'series' | 'genre' | 'books-read'

export interface NavigationContextValue {
  onOpen: (book: Book) => void
  // For 'books-read' the value is a year, or '' for all time.
  onOpenDrilldown: (kind: DrilldownKind, value: string) => void
  onOpenWantToRead: () => void
  onEditReadingGoal: () => void
}

export type CsvAction = 'import' | 'export'

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
  csvBusy: CsvAction | null
  goTo: (viewId: string) => void
  onAddBook: () => void
  onNewCollection: CommandAction
  onRefresh: CommandAction
  onImportCsv: CommandAction
  onExportCsv: CommandAction
}
