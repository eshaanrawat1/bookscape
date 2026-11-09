import { useEffect, useRef } from 'react'
import { Target } from 'lucide-react'
import BookCover from '../books/BookCover.jsx'
import Progress from '../ui/Progress.jsx'
import { useLibraryData } from '../../context/LibraryDataContext.jsx'
import { useNavigation } from '../../context/NavigationContext.jsx'
import type { BookProps } from '../../types.js'

// Slots past a met goal; never filled, so there's always more ahead.
const BONUS_SLOTS = 5

// What's still to go: one slot per book left, or the bonus run once the goal is met, never both.
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

function ReadingGoalCard() {
  const { readingGoal } = useLibraryData()
  const { onEditReadingGoal } = useNavigation()
  const { year, target, read, booksRead, loading } = readingGoal
  const stripRef = useRef<HTMLDivElement | null>(null)
  const boundaryRef = useRef<HTMLDivElement | null>(null)

  // Rests the scroller on the read/unread boundary; the ends are January and empty boxes.
  useEffect(() => {
    const strip = stripRef.current
    const boundary = boundaryRef.current
    if (!strip || !boundary) return
    // Measured because offsetLeft depends on which ancestor is positioned.
    const offsetInContent =
      strip.scrollLeft + boundary.getBoundingClientRect().left - strip.getBoundingClientRect().left
    strip.scrollLeft = Math.max(0, offsetInContent - strip.clientWidth * 0.35)
  }, [booksRead, target])

  // Nothing until the target is known, or the invitation flashes before the bar.
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
