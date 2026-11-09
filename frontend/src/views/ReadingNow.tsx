import { useMemo } from 'react'
import ContinueReading from '../components/books/ContinueReading.jsx'
import ReadingGoalCard from '../components/goal/ReadingGoalCard.jsx'
import Shelf from '../components/books/Shelf.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import { selectSeriesProgress, selectSuggestedBooks } from '../selectors.js'

function ReadingNow() {
  const { books, currentlyReading, wantToRead, collections, booksByIds } = useLibraryData()
  const { onOpenWantToRead } = useNavigation()
  const seriesInProgress = useMemo(() => selectSeriesProgress(books), [books])
  const suggested = useMemo(() => selectSuggestedBooks(books), [books])
  return (
    <div className="stack">
      <ReadingGoalCard />
      <ContinueReading books={currentlyReading} series={seriesInProgress} />
      <Shelf
        title="Suggested"
        subtitle="Because of what you finished recently."
        books={suggested}
      />
      <Shelf
        title="Up next"
        subtitle="Saved for the right moment."
        books={wantToRead.slice(0, 30)}
        onSeeAll={onOpenWantToRead}
      />
      {collections
        .filter((collection) => collection.bookIds.length > 0)
        .map((collection) => (
          <Shelf
            key={collection.id}
            title={collection.name}
            subtitle="Kept together on purpose."
            books={booksByIds(collection.bookIds)}
          />
        ))}
    </div>
  )
}

export default ReadingNow
