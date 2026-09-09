import { useEffect, useRef } from 'react'
import { Target } from 'lucide-react'
import BookCover from './BookCover.jsx'
import Progress from './Progress.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import type { Book } from '../types.js'

// The strip scrolls rather than wraps, so a good year cannot make this taller
// than the shelves below it. Past this only the most recent covers are kept.
const MAX_COVERS = 24

// Slots trailing the covers, for the year still open. A handful rather than one
// per remaining book: the count is stated in words above, so these show that
// the row continues without turning into a wall of empty boxes.
const TRAILING_SLOTS = 4

// The year's goal, at the top of Reading Now: a heading, a meter, and the year
// so far. With no goal set it is one line, since an empty progress bar would
// report failure at something never started.
function ReadingGoalCard() {
  const { readingGoal } = useLibraryData()
  const { onEditReadingGoal } = useNavigation()
  const { year, target, read, booksRead, loading } = readingGoal
  const stripRef = useRef<HTMLDivElement | null>(null)

  // The strip runs oldest to newest, so its resting position is the right-hand
  // end: what you have just read, and the slots still open. Left as-is it would
  // open on January, the least useful view of the year.
  useEffect(() => {
    const strip = stripRef.current
    if (strip) strip.scrollLeft = strip.scrollWidth
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
  const covers = read.slice(-MAX_COVERS)
  // Numbered from where the reading actually ends, not from the end of the
  // truncated strip, so the numbers stay true when covers are capped.
  const slots = Array.from(
    { length: Math.min(TRAILING_SLOTS, remaining) },
    (_, index) => booksRead + index + 1,
  )

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

      {(covers.length > 0 || slots.length > 0) && (
        <div className="goalSlots" ref={stripRef}>
          {covers.map((book) => (
            <GoalCover key={book.id} book={book} />
          ))}
          {slots.map((number) => (
            <div key={`slot-${number}`} className="goalSlot goalSlotEmpty" aria-hidden="true">
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
      <BookCover book={book} />
    </button>
  )
}

export default ReadingGoalCard
