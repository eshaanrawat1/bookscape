import { Target } from 'lucide-react'
import Progress from './Progress.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'

// The goal in the corner of the sidebar, so it is on every page. One button,
// not a row with a link inside it: the whole thing does the one thing.
function ReadingGoalWidget() {
  const { readingGoal } = useLibraryData()
  const { onEditReadingGoal } = useNavigation()
  const { year, target, booksRead, loading } = readingGoal

  if (loading) return null

  const hasGoal = target > 0
  const percent = hasGoal ? Math.min(100, Math.round((booksRead / target) * 100)) : 0

  return (
    <section className="goalWidget">
      <button
        type="button"
        className="goalWidgetButton"
        onClick={onEditReadingGoal}
        aria-label={
          hasGoal
            ? `Reading goal for ${year}: ${booksRead} of ${target} books. Edit goal.`
            : `Set a reading goal for ${year}.`
        }
      >
        <span className="goalWidgetTop">
          <Target />
          <span className="goalWidgetLabel">{hasGoal ? 'Reading Goal' : 'Set a reading goal'}</span>
        </span>
        {hasGoal && (
          <>
            <Progress value={percent} />
            <span className="goalWidgetFoot">
              <span className="goalWidgetCount">{booksRead}/{target} books</span>
              <span className="goalWidgetEdit">Edit goal</span>
            </span>
          </>
        )}
      </button>
    </section>
  )
}

export default ReadingGoalWidget
