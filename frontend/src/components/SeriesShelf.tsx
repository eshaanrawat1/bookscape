import BookCover from './BookCover.jsx'
import ProgressRing from './ProgressRing.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import { normaliseBook } from '../utils.js'
import type { SeriesProgress } from '../types.js'

interface SeriesShelfProps {
  series: SeriesProgress[]
}

// The series half of Reading Now: the sets you are inside of, next to the books
// you are inside of. It answers the question a shelf of loose covers cannot —
// which of these is nearly done, and which book carries on from where you are.
function SeriesShelf({ series }: SeriesShelfProps) {
  if (!series.length) return null

  return (
    <section className="shelf">
      <div className="shelfHeader">
        <div>
          <h2>Series in progress</h2>
          <p>Partway through, with the next book waiting.</p>
        </div>
      </div>
      <div className="shelfScroll">
        {series.map((entry) => (
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

export default SeriesShelf
