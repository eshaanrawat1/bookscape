import { useState } from 'react'
import { X } from 'lucide-react'
import useModalLayer from '../hooks/useModalLayer.js'
import { booksPerYear, daysPerBook, MAX_READING_GOAL } from '../hooks/useReadingGoal.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'

interface ReadingGoalDialogProps {
  onClose: () => void
}

const PRESETS = [12, 24, 52, 100]

// What the field starts on when there is no goal yet: two books a month, the
// least intimidating of the presets that still asks for a habit.
const DEFAULT_TARGET = 24

const onlyDigits = (raw: string): string => raw.replace(/\D/g, '').slice(0, 4)

// Set or edit the year's goal. Two fields for one number: the count of books,
// and the pace that count works out to. Either can be typed in and the other
// follows, because "a book a week" and "52 books" are the same intention
// arrived at from opposite directions — and a pace is the easier one to know
// about yourself.
function ReadingGoalDialog({ onClose }: ReadingGoalDialogProps) {
  const { readingGoal } = useLibraryData()
  const { year, target, booksRead, saving, error, save, clear } = readingGoal

  const [booksDraft, setBooksDraft] = useState(() => String(target > 0 ? target : DEFAULT_TARGET))
  const [daysDraft, setDaysDraft] = useState(() => String(daysPerBook(target > 0 ? target : DEFAULT_TARGET)))

  // Escape is swallowed while a save is in flight rather than falling through
  // to whatever is behind the dialog.
  useModalLayer({ onEscape: saving ? undefined : onClose, blocksHotkeys: true })

  // Only the field you are not typing in is recomputed. Rewriting both on every
  // keystroke would round "100" back to "91" under the cursor, since a book
  // every 4 days is 91 books rather than 100.
  const handleBooks = (raw: string) => {
    const digits = onlyDigits(raw)
    setBooksDraft(digits)
    const count = Number(digits)
    if (count > 0) setDaysDraft(String(daysPerBook(Math.min(MAX_READING_GOAL, count))))
  }

  const handleDays = (raw: string) => {
    const digits = onlyDigits(raw)
    setDaysDraft(digits)
    const days = Number(digits)
    if (days > 0) setBooksDraft(String(booksPerYear(days)))
  }

  const choosePreset = (preset: number) => {
    setBooksDraft(String(preset))
    setDaysDraft(String(daysPerBook(preset)))
  }

  const nextTarget = Number(booksDraft)
  const valid = Number.isFinite(nextTarget) && nextTarget >= 1 && nextTarget <= MAX_READING_GOAL

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || saving) return
    try {
      await save(nextTarget)
      onClose()
    } catch {
      // save() has already put the reason in `error`; the dialog stays open on
      // the number that was typed rather than closing over a failed write.
    }
  }

  const handleRemove = async () => {
    if (saving) return
    try {
      await clear()
      onClose()
    } catch {
      // Same posture as a failed save.
    }
  }

  return (
    <div className="dialogScrim" onClick={() => { if (!saving) onClose() }}>
      <article
        className="bookDialog scraperDialog goalDialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Reading goal for ${year}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="dialogIconButton dialogClose"
          onClick={onClose}
          disabled={saving}
          aria-label="Close dialog"
        >
          <X />
        </button>

        <h2>Reading Goal</h2>
        <p className="dialogDescription">
          How many books do you want to finish in {year}? Bookscape counts anything you
          mark finished with a date this year.
        </p>

        <form onSubmit={handleSubmit} className="scraperForm">
          <div className="scraperField">
            <label htmlFor="goal-books" className="scraperLabel">Books this year</label>
            <div className="goalPresetRow">
              <input
                id="goal-books"
                type="text"
                inputMode="numeric"
                className="scraperInput goalNumberInput"
                value={booksDraft}
                onChange={(event) => handleBooks(event.target.value)}
                disabled={saving}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Books this year"
              />
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={nextTarget === preset ? 'goalPreset active' : 'goalPreset'}
                  onClick={() => choosePreset(preset)}
                  disabled={saving}
                  aria-pressed={nextTarget === preset}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="scraperField">
            <label htmlFor="goal-days" className="scraperLabel">Or set a pace</label>
            <div className="goalPaceRow">
              <span>One book every</span>
              <input
                id="goal-days"
                type="text"
                inputMode="numeric"
                className="scraperInput goalNumberInput"
                value={daysDraft}
                onChange={(event) => handleDays(event.target.value)}
                disabled={saving}
                aria-label="Days per book"
              />
              <span>days</span>
            </div>
          </div>

          <p className="goalHint">
            You’ve read {booksRead} so far this year.
            {valid && nextTarget <= booksRead && ' This target is already behind you.'}
          </p>

          {error && <p className="scraperError">{error}</p>}

          <div className="scraperButtons goalDialogButtons">
            {target > 0 && (
              <button type="button" className="goalRemoveButton" onClick={handleRemove} disabled={saving}>
                Remove goal
              </button>
            )}
            <button type="button" className="secondaryButton" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="primaryButton" disabled={saving || !valid}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </article>
    </div>
  )
}

export default ReadingGoalDialog
