import { ChevronRight, Star } from 'lucide-react'
import BookCover from '../components/BookCover.jsx'
import useSeriesBooks from '../hooks/useSeriesBooks.js'
import { useNavigation } from '../context/NavigationContext.jsx'
import type { Book, ReadingStatus } from '../types.js'

interface SeriesViewProps {
  series: string
}

// Where you are in the series, which is what the rows mark. The same question
// get_series_progress() answers on the server for the Reading Now shelf, decided
// locally here because this page already holds every book with its reading
// status attached.
function summariseSeries(books: Book[]) {
  // The book in your hands, else the first in reading order you have not
  // settled either way — a book you put down is a decision, not a gap.
  const nextUp =
    books.find((book) => book.status === 'reading') ||
    books.find((book) => book.status === 'not_started') ||
    null
  return {
    nextUp,
    started: books.some((book) => book.status !== 'not_started'),
  }
}

const ROW_MARKERS: Record<ReadingStatus, string> = {
  done: 'Read',
  reading: 'Reading',
  dnf: 'DNF',
  not_started: 'Not started',
}

function SeriesView({ series }: SeriesViewProps) {
  const { books, loading, error } = useSeriesBooks(series)
  const { onOpen } = useNavigation()

  const numbered = books.filter((book) => book.seriesNumber).length
  const summary = summariseSeries(books)

  return (
    <div className="stack authorPage">
      {loading ? (
        <div className="emptyState">
          <p>Loading series books…</p>
        </div>
      ) : error ? (
        <div className="emptyState">
          <h2>Could not load series</h2>
          <p>{error}</p>
        </div>
      ) : books.length > 0 ? (
        <section className="authorBooksSection">
          <div className="shelfHeader">
            <h2>{books.length === 1 ? '1 book' : `${books.length} books`}</h2>
            <p className="authorBooksCaption">
              {numbered > 0
                ? 'In reading order'
                : 'Every title in the catalog from this series'}
            </p>
          </div>
          <ul className="authorBookList">
            {books.map((book) => (
              <SeriesBookRow
                key={book.id}
                book={book}
                // "Up next" is a claim about where you are in the series, so
                // it needs a place to be next from. On a series you have never
                // opened it would land on book one of all 343 of them and mean
                // nothing more than "series start".
                isNextUp={summary.started && book.id === summary.nextUp?.id}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </section>
      ) : (
        <div className="emptyState">
          <h2>No books found</h2>
          <p>We couldn't find any titles in the catalog for this series.</p>
        </div>
      )}
    </div>
  )
}

interface SeriesBookRowProps {
  book: Book
  isNextUp: boolean
  onOpen: (book: Book) => void
}

function SeriesBookRow({ book, isNextUp, onOpen }: SeriesBookRowProps) {
  // "Up next" is the one label that replaces rather than adds: it only ever
  // lands on an untouched book, since a book you are already reading says so
  // itself and saying both would be one label too many for one row.
  const marker = book.status === 'not_started' && isNextUp ? 'Up next' : ROW_MARKERS[book.status]

  return (
    <li>
      <button type="button" className="authorBookRow seriesBookRow" onClick={() => onOpen(book)}>
        {/* Books without a number still get the slot so covers stay aligned
            down the column — a prequel is common enough that a ragged list
            would be the normal case, not the exception. */}
        <span className="seriesBookRowNumber" aria-hidden={!book.seriesNumber}>
          {book.seriesNumber ? `#${book.seriesNumber}` : ''}
        </span>
        <div className="authorBookRowCover">
          <BookCover book={book} />
        </div>
        <div className="authorBookRowCopy">
          <strong>{book.title}</strong>
          {book.author ? <span>{book.author}</span> : null}
        </div>
        <span
          className={`seriesRowMarker ${markerToneClass(book.status, isNextUp)}`}
          // Labelled rather than read from its own text: narrow widths drop the
          // word and keep only the coloured dot, and a dot on its own says
          // nothing to a screen reader.
          aria-label={marker}
        >
          <span className="seriesRowMarkerDot" />
          <span className="seriesRowMarkerLabel">{marker}</span>
        </span>
        <span className="authorBookRowRating">
          {book.rating > 0 ? (
            <>
              <Star fill="currentColor" />
              <span>{book.rating.toFixed(2)}</span>
            </>
          ) : null}
        </span>
        <ChevronRight className="authorBookRowChevron" />
      </button>
    </li>
  )
}

function markerToneClass(status: ReadingStatus, isNextUp: boolean): string {
  if (status === 'done') return 'isRead'
  if (status === 'reading') return 'isReading'
  if (status === 'dnf') return 'isDnf'
  return isNextUp ? 'isNextUp' : 'isNotStarted'
}

export default SeriesView
