import { ChevronRight, Star } from 'lucide-react'
import BookCover from '../components/BookCover.jsx'
import useSeriesBooks from '../hooks/useSeriesBooks.js'
import { useNavigation } from '../context/NavigationContext.jsx'
import type { Book } from '../types.js'

interface SeriesViewProps {
  series: string
}

function SeriesView({ series }: SeriesViewProps) {
  const { books, loading, error } = useSeriesBooks(series)
  const { onOpen } = useNavigation()

  const numbered = books.filter((book) => book.seriesNumber).length

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
              <SeriesBookRow key={book.id} book={book} onOpen={onOpen} />
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
  onOpen: (book: Book) => void
}

function SeriesBookRow({ book, onOpen }: SeriesBookRowProps) {
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

export default SeriesView
