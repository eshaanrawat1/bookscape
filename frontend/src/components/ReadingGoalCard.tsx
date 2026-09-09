import { useEffect, useRef } from 'react'
import { Target } from 'lucide-react'
import BookCover from './BookCover.jsx'
import Progress from './Progress.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import type { Book } from '../types.js'

// The year's goal, at the top of Reading Now: a heading, a meter, and the year
// so far. With no goal set it is one line, since an empty progress bar would
// report failure at something never started.
function ReadingGoalCard() {
  const { readingGoal } = useLibraryData()
  const { onEditReadingGoal } = useNavigation()
  const { year, target, read, booksRead, loading } = readingGoal
  const stripRef = useRef<HTMLDivElement | null>(null)
  const boundaryRef = useRef<HTMLDivElement | null>(null)

  // The strip runs oldest to newest and can be a whole year long, so it rests
  // on the boundary between read and unread: the books just finished on the
  // left, the next open slots on the right. Both ends are worse views — the
  // start is January, and the far end is nothing but empty boxes.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const boundary = boundaryRef.current
    if (!boundary) {
      // Goal met: no slots left, so the newest covers are the end of the row.
      strip.scrollLeft = strip.scrollWidth
      return
    }
    // Measured rather than derived from offsetLeft, which is relative to
    // whichever ancestor happens to be positioned.
    const offsetInContent =
      strip.scrollLeft + boundary.getBoundingClientRect().left - strip.getBoundingClientRect().left
    strip.scrollLeft = Math.max(0, offsetInContent - strip.clientWidth * 0.35)
  }, [booksRead, target])

  // Nothing until the target is known: an invitation that swaps to a full
  // progress bar a beat later reads as a glitch.
  if (loading) return null

  if (target <= 0) {
    return (
      <section className="goalCard goalCardEmpty">
        <div className="goalMark" aria-hidden="true">
          <Target />
        </div>
        <h2>Reading Goal {year}</h2>
        <button type="button" className="secondaryButton goalSetButton" onClick={onEditReadingGoal}>
          Set a goal
        </button>
      </section>
    )
  }

  const percent = Math.min(100, Math.round((booksRead / target) * 100))
  const remaining = Math.max(0, target - booksRead)
  // The whole year, in order: a cover for every book read, then a numbered slot
  // for every one still to go, ending at the target. Covers load lazily so a
  // long row costs what is on screen rather than the full year of images.
  const slots = Array.from({ length: remaining }, (_, index) => booksRead + index + 1)

  return (
    <section className="goalCard">
      <div className="goalTop">
        <div className="goalMark" aria-hidden="true">
          <Target />
        </div>
        <h2>Reading Goal {year}</h2>
        <div className="goalMeter">
          <Progress value={percent} />
          <div className="goalMeterRow">
            <p className="goalMeterText">
              You’ve read <strong>{booksRead}</strong> out of {target} books ({percent}%)
            </p>
            <button type="button" className="goalEditButton" onClick={onEditReadingGoal}>
              Edit goal
            </button>
          </div>
        </div>
      </div>

      {(read.length > 0 || slots.length > 0) && (
        <div className="goalSlots" ref={stripRef}>
          {read.map((book) => (
            <GoalCover key={book.id} book={book} />
          ))}
          {slots.map((number, index) => (
            <div
              key={`slot-${number}`}
              ref={index === 0 ? boundaryRef : undefined}
              className="goalSlot goalSlotEmpty"
              aria-hidden="true"
            >
              <span>{number}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function GoalCover({ book }: { book: Book }) {
  const { onOpen } = useNavigation()
  return (
    <button
      type="button"
      className="goalSlot goalSlotBook"
      onClick={() => onOpen(book)}
      title={`${book.title}${book.author ? ` by ${book.author}` : ''}`}
    >
      <BookCover book={book} lazy />
    </button>
  )
}

export default ReadingGoalCard
