import { BookList, BookListRow } from '../components/books/BookList.jsx'
import CatalogPage from '../components/books/CatalogPage.jsx'
import useSeriesBooks from '../hooks/useSeriesBooks.js'
import type { Book, BookProps, ReadingStatus } from '../types.js'

interface SeriesViewProps {
  series: string
}

// Mirrors get_series_progress() on the server, done locally since this page has every book.
function summariseSeries(books: Book[]) {
  // The book in hand, else the first unread; a book you put down is skipped.
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
            // Needs a started series; otherwise it would just mark book one.
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
  // Only lands on untouched books, since one being read already says so.
  const marker = book.status === 'not_started' && isNextUp ? 'Up next' : ROW_MARKERS[book.status]

  return (
    <BookListRow
      book={book}
      subtitle={book.author}
      className="seriesBookRow"
      leading={
        // Unnumbered books keep the slot so covers stay aligned.
        <span className="seriesBookRowNumber" aria-hidden={!book.seriesNumber}>
          {book.seriesNumber ? `#${book.seriesNumber}` : ''}
        </span>
      }
      trailing={
        <span
          className={`seriesRowMarker ${markerToneClass(book.status, isNextUp)}`}
          // Labelled because narrow widths drop the word and keep only the dot.
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
