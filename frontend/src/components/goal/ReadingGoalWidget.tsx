import { useState } from 'react'
import { ChevronDown, ChevronUp, Target } from 'lucide-react'
import Progress from '../ui/Progress.jsx'
import { useLibraryData } from '../../context/LibraryDataContext.jsx'
import { useNavigation } from '../../context/NavigationContext.jsx'

// UI chrome, so localStorage rather than the API; access is guarded for webviews without storage.
const STORAGE_KEY = 'bookscape.goalWidgetOpen'

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function writeOpen(open: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(open))
  } catch {
    /* storage is full or unavailable — the fold still works for this session */
  }
}

function ReadingGoalWidget() {
  const { readingGoal } = useLibraryData()
  const { onEditReadingGoal } = useNavigation()
  const { year, target, booksRead, loading } = readingGoal
  const [open, setOpen] = useState(readOpen)

  const toggle = () => {
    setOpen((value) => {
      const next = !value
      writeOpen(next)
      return next
    })
  }

  if (loading) return null

  const hasGoal = target > 0
  const percent = hasGoal ? Math.min(100, Math.round((booksRead / target) * 100)) : 0

  return (
    <section className="goalWidget">
      <button
        type="button"
        className="goalWidgetToggle"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? 'Hide reading goal' : 'Show reading goal'}
      >
        <span className="goalWidgetTop">
          <Target />
          <span className="goalWidgetLabel">Reading Goal</span>
        </span>
        <span className="goalWidgetChevron" aria-hidden="true">
          {open ? <ChevronDown /> : <ChevronUp />}
        </span>
      </button>
      {open && (
        <button
          type="button"
          className="goalWidgetBody"
          onClick={onEditReadingGoal}
          aria-label={
            hasGoal
              ? `Reading goal for ${year}: ${booksRead} of ${target} books. Edit goal.`
              : `Set a reading goal for ${year}.`
          }
        >
          <Progress value={percent} />
          <span className="goalWidgetFoot">
            {hasGoal && <span className="goalWidgetCount">{booksRead}/{target} books</span>}
            <span className="goalWidgetEdit">{hasGoal ? 'Edit goal' : 'Set goal'}</span>
          </span>
        </button>
      )}
    </section>
  )
}

export default ReadingGoalWidget
