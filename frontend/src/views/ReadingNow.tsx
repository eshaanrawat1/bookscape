import ContinueReading from '../components/books/ContinueReading.jsx'
import ReadingGoalCard from '../components/goal/ReadingGoalCard.jsx'
import Shelf from '../components/books/Shelf.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import useSeriesProgress from '../hooks/useSeriesProgress.js'
import useSuggestedBooks from '../hooks/useSuggestedBooks.js'

function ReadingNow() {
  const { currentlyReading, wantToRead, collections, booksByIds } = useLibraryData()
  const { onOpenWantToRead } = useNavigation()
  const seriesInProgress = useSeriesProgress()
  const suggested = useSuggestedBooks()
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
        .filter((collection) => (collection.books?.length || collection.bookIds?.length || 0) > 0)
        .map((collection) => (
          <Shelf
            key={collection.id}
            title={collection.name}
            subtitle="Kept together on purpose."
            books={collection.books?.length ? collection.books : booksByIds(collection.bookIds)}
          />
        ))}
    </div>
  )
}

export default ReadingNow
