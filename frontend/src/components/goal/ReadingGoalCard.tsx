import { useEffect, useRef } from 'react'
import { Target } from 'lucide-react'
import BookCover from '../books/BookCover.jsx'
import Progress from '../ui/Progress.jsx'
import { useLibraryData } from '../../context/LibraryDataContext.jsx'
import { useNavigation } from '../../context/NavigationContext.jsx'
import type { BookProps } from '../../types.js'

// How many bonus slots sit past a met goal. They are never filled — read 25
// against a goal of 20 and there are still five ahead of you — so the run is an
// invitation to keep going rather than a second target you are behind on.
const BONUS_SLOTS = 5

// The open end of the row: what is still to go. Below the goal that is one slot
// per book left, counting up to the target; at or past it, the bonus run. Never
// both — an unmet goal should show what is left and nothing else, so the gold
// only ever appears once the target is actually behind you. Both kinds are the
// same numbered slot, so the count runs unbroken across the goal and the only
// thing the bonus run changes is its colour.
type GoalSlot = { key: string; number: number; bonus: boolean }

function openSlots(booksRead: number, target: number): GoalSlot[] {
  const met = booksRead >= target
  const count = met ? BONUS_SLOTS : target - booksRead
  return Array.from({ length: count }, (_, index) => ({
    key: `slot-${booksRead + index + 1}`,
    number: booksRead + index + 1,
    bonus: met,
  }))
}

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
  // start is January, and the far end is nothing but empty boxes. There is
  // always a boundary to rest on, since a met goal still has its bonus slots.
  useEffect(() => {
    const strip = stripRef.current
    const boundary = boundaryRef.current
    if (!strip || !boundary) return
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
  // The whole year, in order: a cover for every book read, then the slots still
  // open ahead of it. Covers load lazily so a long row costs what is on screen
  // rather than the full year of images.
  const slots = openSlots(booksRead, target)

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

      <div className="goalSlots" ref={stripRef}>
        {read.map((book) => (
          <GoalCover key={book.id} book={book} />
        ))}
        {slots.map((slot, index) => (
          <div
            key={slot.key}
            ref={index === 0 ? boundaryRef : undefined}
            className={slot.bonus ? 'goalSlot goalSlotEmpty goalSlotBonus' : 'goalSlot goalSlotEmpty'}
            aria-hidden="true"
          >
            <span>{slot.number}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function GoalCover({ book }: BookProps) {
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
