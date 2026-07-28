import Shelf from '../components/Shelf.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'

function LibraryView() {
  const { globalLibrary } = useLibraryData()
  const { onOpenGenre } = useNavigation()
  if (!globalLibrary || globalLibrary.length === 0) {
    return (
      <div className="emptyState">
        <p>Loading library...</p>
      </div>
    )
  }
  return (
    <div className="stack">
      {globalLibrary.map((genreSection) => (
        <Shelf
          key={genreSection.genre}
          title={genreSection.genre}
          books={genreSection.books}
          onSeeAll={onOpenGenre}
        />
      ))}
    </div>
  )
}

export default LibraryView
