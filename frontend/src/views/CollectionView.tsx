import BookGrid from '../components/BookGrid.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import type { Collection } from '../types.js'

interface CollectionViewProps {
  activeCollection: Collection | null
}

function CollectionView({ activeCollection }: CollectionViewProps) {
  const { booksByIds, removeBookFromCollection } = useLibraryData()
  if (!activeCollection) return null

  const books = activeCollection.books?.length ? activeCollection.books : booksByIds(activeCollection.bookIds)

  return (
    <div className="stack">
      <div className="shelfHeader">
        <div>
          <h2>{activeCollection.name}</h2>
          <p>{activeCollection.description || 'Custom collection'}</p>
        </div>
      </div>
      <BookGrid
        books={books}
        showRemoveButton
        removeLabel={activeCollection.name}
        onRemove={(bookId) => removeBookFromCollection(activeCollection.name, bookId)}
      />
    </div>
  )
}

export default CollectionView
