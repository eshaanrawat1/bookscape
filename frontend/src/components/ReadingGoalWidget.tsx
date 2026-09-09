import { useState } from 'react'
import { ChevronDown, ChevronUp, Target } from 'lucide-react'
import Progress from './Progress.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'

// The goal in the corner of the sidebar, so it is on every page. The header row
// folds it away; what is left below the header still does the one thing.
function ReadingGoalWidget() {
  const { readingGoal } = useLibraryData()
  const { onEditReadingGoal } = useNavigation()
  const { year, target, booksRead, loading } = readingGoal
  const [open, setOpen] = useState(true)

  if (loading) return null

  const hasGoal = target > 0
  const percent = hasGoal ? Math.min(100, Math.round((booksRead / target) * 100)) : 0

  return (
    <section className="goalWidget">
      <button
        type="button"
        className="goalWidgetToggle"
        onClick={() => setOpen((value) => !value)}
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
