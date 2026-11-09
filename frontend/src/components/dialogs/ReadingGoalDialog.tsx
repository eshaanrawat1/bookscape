import { useState } from 'react'
import Dialog, { type DialogCloseProps } from './Dialog.jsx'
import { booksPerYear, daysPerBook, MAX_READING_GOAL } from '../../hooks/useReadingGoal.js'
import { useLibraryData } from '../../context/LibraryDataContext.jsx'

const PRESETS = [12, 24, 52, 100]

const DEFAULT_TARGET = 24

const onlyDigits = (raw: string): string => raw.replace(/\D/g, '').slice(0, 4)

function ReadingGoalDialog({ onClose }: DialogCloseProps) {
  const { readingGoal } = useLibraryData()
  const { year, target, booksRead, saving, error, save, clear } = readingGoal

  const [booksDraft, setBooksDraft] = useState(() => String(target > 0 ? target : DEFAULT_TARGET))
  const [daysDraft, setDaysDraft] = useState(() => String(daysPerBook(target > 0 ? target : DEFAULT_TARGET)))

  // Recompute only the other field; rewriting both would round "100" back to "91" under the cursor.
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
      // save() already set `error`; stay open on the typed number.
    }
  }

  const handleRemove = async () => {
    if (saving) return
    try {
      await clear()
      onClose()
    } catch {
      // clear() already set `error`; stay open.
    }
  }

  return (
    <Dialog label={`Reading goal for ${year}`} className="scraperDialog goalDialog" busy={saving} onClose={onClose}>
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
    </Dialog>
  )
}

export default ReadingGoalDialog
