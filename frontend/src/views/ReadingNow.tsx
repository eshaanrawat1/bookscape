import ContinueReading from '../components/ContinueReading.jsx'
import Shelf from '../components/Shelf.jsx'
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
      <ContinueReading books={currentlyReading} series={seriesInProgress} />
      {/* Below "Continue reading" and above "Up next": both of those are books
          you have already chosen, and this one is the page's only guess. It
          earns its place under them, not over them. Shelf renders nothing on an
          empty list, so a library with nothing finished simply has no such
          row. */}
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
