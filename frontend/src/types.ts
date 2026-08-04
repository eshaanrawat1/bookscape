export type ReadingStatus = 'not_started' | 'reading' | 'done'

// Raw payload shapes vary across endpoints (/my-books, /global-library, /search,
// /author-books, /genre-books, /book/{id}); normaliseBook() is the single place
// that coerces whichever fields are present into a Book.
export interface RawBookPayload {
  id?: string
  uid?: string
  title?: string
  author?: string
  cover?: string
  image_url?: string
  color?: string
  linked_catalog_book?: { color?: string } | null
  genre?: string
  genres?: string[]
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
  book_rating?: number | string
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
  tint: string
  genre: string
  genres: string[]
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

// One carousel card: a superlative, the number that earned it, and the book that
// won. The backend picks these and never repeats a book across cards, so the
// list is already display-ready and can be shorter than the six specs.
export interface FeaturedStat {
  key: string
  label: string
  value: number
  unit: string
  book: Book
}

export interface StatsSummary {
  available_years: number[]
  books_read: number
  pages_read: number
  genres_covered: number
  genre_list: string[]
  densest_book: Book | null
  most_time_spent: Book | null
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
  addBookToCollection: (collectionName: string, bookId: string) => Promise<void>
  removeBookFromCollection: (collectionName: string, bookId: string) => Promise<void>
  toggleBookWantToRead: (bookId: string, isSaved: boolean) => Promise<void>
  createCollection: () => Promise<string>
  renameCollection: (collection: Collection, name: string) => Promise<string>
  deleteCollection: (collection: Collection) => Promise<void>
}

export interface NavigationContextValue {
  onOpen: (book: Book) => void
  onOpenAuthor: (author: string) => void
  onOpenGenre: (genre: string) => void
  onOpenReadingNow: (book: Book) => void
}
