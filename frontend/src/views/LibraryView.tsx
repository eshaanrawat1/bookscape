import { useMemo } from 'react'
import Shelf from '../components/books/Shelf.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import { selectLibrarySections } from '../selectors.js'

function LibraryView() {
  const { books } = useLibraryData()
  const { onOpenGenre } = useNavigation()
  const sections = useMemo(() => selectLibrarySections(books), [books])
  if (sections.length === 0) {
    return <EmptyState message="Your library is empty." />
  }
  return (
    <div className="stack">
      {sections.map((genreSection) => (
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
