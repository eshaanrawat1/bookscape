import BookCard from './BookCard.jsx'
import BookCover from './BookCover.jsx'
import ProgressRing from './ProgressRing.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import { normaliseBook } from '../utils.js'
import type { Book, SeriesProgress } from '../types.js'

interface ContinueReadingProps {
  books: Book[]
  series: SeriesProgress[]
}

// One row for everything you are in the middle of: the loose books you have
// open, and the sets you are partway through. They were two rows and read as
// two answers to the same question — worse, the same book appeared in both,
// since a series you are actively reading points at the very book sitting on
// the shelf above it. Merging them lets that duplicate collapse into the one
// card that says more: the series card carries the cover *and* your position in
// the set.
function ContinueReading({ books, series }: ContinueReadingProps) {
  // A series card already shows its next book's cover, so that book does not
  // also need a card of its own. Only a series you are reading can collide —
  // its next book is the one in your hands — but every entry is checked so the
  // rule does not depend on which book the backend picked.
  const coveredIds = new Set(
    series.map((entry) => entry.next_book?.id || entry.next_book?.uid).filter(Boolean),
  )
  const looseBooks = books.filter((book) => !coveredIds.has(book.id))

  // Anything you are mid-book on comes first, whether it is a lone book or a
  // series. The tail is the series you are between books on: still in progress,
  // but nothing is open. Partitioned here rather than trusted from the payload
  // so the order holds however /series-progress sorts.
  const readingSeries = series.filter((entry) => entry.reading > 0)
  const restSeries = series.filter((entry) => entry.reading === 0)

  if (!looseBooks.length && !series.length) return null

  return (
    <section className="shelf">
      <div className="shelfHeader">
        <div>
          <h2>Continue reading</h2>
          <p>Books and series you are partway through.</p>
        </div>
      </div>
      <div className="shelfScroll">
        {readingSeries.map((entry) => (
          <SeriesCard key={entry.series} entry={entry} />
        ))}
        {looseBooks.map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
        {restSeries.map((entry) => (
          <SeriesCard key={entry.series} entry={entry} />
        ))}
      </div>
    </section>
  )
}

function SeriesCard({ entry }: { entry: SeriesProgress }) {
  const { onOpenSeries } = useNavigation()
  // The payload is a raw catalog row like every other endpoint's, so the cover
  // is built the same way the rest of the app builds one rather than from a
  // second hand-rolled shape.
  const nextBook = entry.next_book ? normaliseBook(entry.next_book) : null
  const reading = nextBook?.status === 'reading'

  return (
    <div className="bookCard seriesCard">
      <button type="button" className="bookCardButton" onClick={() => onOpenSeries(entry.series)}>
        <div className="coverWrap">
          {/* The cover belongs to the next book, not to the series, so the card
              says which one it is showing — otherwise it reads as a series
              whose art happens to be book three's. */}
          {nextBook ? <BookCover book={nextBook} /> : <div className="seriesCardNoCover" />}
          {nextBook && (
            <span className={`seriesCardFlag ${reading ? 'isReading' : 'isNextUp'}`}>
              {reading ? 'Reading' : 'Up next'}
            </span>
          )}
        </div>
        <strong>{entry.series}</strong>
      </button>
      <div className="seriesCardMeta">
        <ProgressRing
          value={entry.read}
          total={entry.total}
          size={18}
          showLabel={false}
          label={`${entry.read} of ${entry.total} books read`}
        />
        <span>
          {entry.read} of {entry.total} read
        </span>
      </div>
    </div>
  )
}

export default ContinueReading
