import BookCard from './BookCard.jsx'
import BookCover from './BookCover.jsx'
import CoverProgress from './CoverProgress.jsx'
import ProgressRing from '../ui/ProgressRing.jsx'
import SectionHeader from '../ui/SectionHeader.jsx'
import { useNavigation } from '../../context/NavigationContext.jsx'
import { normaliseBook } from '../../utils.js'
import type { Book, SeriesProgress } from '../../types.js'

interface ContinueReadingProps {
  books: Book[]
  series: SeriesProgress[]
}

function ContinueReading({ books, series }: ContinueReadingProps) {
  // A series card already shows its next book, so that book doesn't get its own card.
  const coveredIds = new Set(
    series.map((entry) => entry.next_book?.id || entry.next_book?.uid).filter(Boolean),
  )
  const looseBooks = books.filter((book) => !coveredIds.has(book.id))

  // Mid-book entries first; partitioned here so the order holds however /series-progress sorts.
  const readingSeries = series.filter((entry) => entry.reading > 0)
  const restSeries = series.filter((entry) => entry.reading === 0)

  if (!looseBooks.length && !series.length) return null

  return (
    <section className="shelf">
      <SectionHeader title="Continue reading" subtitle="Books and series you are partway through." />
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
  const { onOpen, onOpenSeries } = useNavigation()
  const nextBook = entry.next_book ? normaliseBook(entry.next_book) : null
  const reading = nextBook?.status === 'reading'

  return (
    <div className="bookCard seriesCard">
      {/* Opens the book like any cover; the series is linked from its name, or here if there's no next book. */}
      <button
        type="button"
        className="bookCardButton"
        onClick={() => (nextBook ? onOpen(nextBook) : onOpenSeries(entry.series))}
      >
        <div className="coverWrap">
          {/* Only "up next" is flagged: every card here is in progress, so silence means mid-book. */}
          {nextBook ? <BookCover book={nextBook} /> : <div className="seriesCardNoCover" />}
          <CoverProgress book={nextBook} />
          {nextBook && !reading && <span className="seriesCardFlag isNextUp">Up next</span>}
        </div>
      </button>
      <button type="button" className="seriesCardTitle" onClick={() => onOpenSeries(entry.series)}>
        <strong>{entry.series}</strong>
      </button>
      <div className="seriesCardMeta">
        <ProgressRing
          value={entry.read}
          total={entry.total}
          size={18}
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
