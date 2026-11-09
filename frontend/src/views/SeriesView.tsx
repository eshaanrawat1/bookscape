import { BookList, BookListRow } from '../components/books/BookList.jsx'
import CatalogPage from '../components/books/CatalogPage.jsx'
import useSeriesBooks from '../hooks/useSeriesBooks.js'
import type { Book, BookProps, ReadingStatus } from '../types.js'

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
  const catalog = useSeriesBooks(series)
  const { books } = catalog

  const numbered = books.filter((book) => book.seriesNumber).length
  const summary = summariseSeries(books)

  return (
    <CatalogPage
      {...catalog}
      className="authorPage"
      loadingMessage="Loading series books…"
      errorTitle="Could not load series"
      emptyTitle="No books found"
      emptyMessage="We couldn't find any titles in the catalog for this series."
    >
      <BookList
        title={books.length === 1 ? '1 book' : `${books.length} books`}
        caption={numbered > 0 ? 'In reading order' : 'Every title in the catalog from this series'}
      >
        {books.map((book) => (
          <SeriesBookRow
            key={book.id}
            book={book}
            // "Up next" is a claim about where you are in the series, so
            // it needs a place to be next from. On a series you have never
            // opened it would land on book one of all 343 of them and mean
            // nothing more than "series start".
            isNextUp={summary.started && book.id === summary.nextUp?.id}
          />
        ))}
      </BookList>
    </CatalogPage>
  )
}

interface SeriesBookRowProps extends BookProps {
  isNextUp: boolean
}

function SeriesBookRow({ book, isNextUp }: SeriesBookRowProps) {
  // "Up next" is the one label that replaces rather than adds: it only ever
  // lands on an untouched book, since a book you are already reading says so
  // itself and saying both would be one label too many for one row.
  const marker = book.status === 'not_started' && isNextUp ? 'Up next' : ROW_MARKERS[book.status]

  return (
    <BookListRow
      book={book}
      subtitle={book.author}
      className="seriesBookRow"
      leading={
        // Books without a number still get the slot so covers stay aligned
        // down the column — a prequel is common enough that a ragged list
        // would be the normal case, not the exception.
        <span className="seriesBookRowNumber" aria-hidden={!book.seriesNumber}>
          {book.seriesNumber ? `#${book.seriesNumber}` : ''}
        </span>
      }
      trailing={
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
      }
    />
  )
}

function markerToneClass(status: ReadingStatus, isNextUp: boolean): string {
  if (status === 'done') return 'isRead'
  if (status === 'reading') return 'isReading'
  if (status === 'dnf') return 'isDnf'
  return isNextUp ? 'isNextUp' : 'isNotStarted'
}

export default SeriesView
