import { useMemo } from 'react'
import { BookList, BookListRow } from '../components/books/BookList.jsx'
import CatalogPage from '../components/books/CatalogPage.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { selectSeriesBooks } from '../selectors.js'
import type { Book, BookProps, ReadingStatus } from '../types.js'

interface SeriesViewProps {
  series: string
}

// Saving a book for later is not starting it.
function isUntouched(status: ReadingStatus): boolean {
  return status === 'not_started' || status === 'want'
}

// Where you are in the series, which is what the rows mark.
function summariseSeries(books: Book[]) {
  // The book in hand, else the first unread; a book you put down is skipped.
  const nextUp =
    books.find((book) => book.status === 'reading') ||
    books.find((book) => isUntouched(book.status)) ||
    null
  return {
    nextUp,
    started: books.some((book) => !isUntouched(book.status)),
  }
}

const ROW_MARKERS: Record<ReadingStatus, string> = {
  done: 'Read',
  reading: 'Reading',
  dnf: 'DNF',
  want: 'Want to read',
  not_started: 'Not started',
}

function SeriesView({ series }: SeriesViewProps) {
  const { books: allBooks } = useLibraryData()
  const books = useMemo(() => selectSeriesBooks(allBooks, series), [allBooks, series])

  const numbered = books.filter((book) => book.series_number).length
  const summary = summariseSeries(books)

  return (
    <CatalogPage
      books={books}
      className="authorPage"
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
  // "Up next" replaces the marker, and only ever lands on an untouched book.
  const marker = isUntouched(book.status) && isNextUp ? 'Up next' : ROW_MARKERS[book.status]

  return (
    <BookListRow
      book={book}
      subtitle={book.author}
      className="seriesBookRow"
      leading={
        // Unnumbered books keep the slot so covers stay aligned.
        <span className="seriesBookRowNumber" aria-hidden={!book.series_number}>
          {book.series_number ? `#${book.series_number}` : ''}
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
