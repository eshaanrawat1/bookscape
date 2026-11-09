import BookGrid from '../components/books/BookGrid.jsx'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import type { Collection } from '../types.js'

interface CollectionViewProps {
  activeCollection: Collection | null
}

function CollectionView({ activeCollection }: CollectionViewProps) {
  const { booksByIds, removeBookFromCollection } = useLibraryData()
  if (!activeCollection) return null

  return (
    <div className="stack">
      <BookGrid
        books={booksByIds(activeCollection.book_ids)}
        showRemoveButton
        removeLabel={activeCollection.name}
        onRemove={(bookId) => removeBookFromCollection(activeCollection.id, bookId)}
      />
    </div>
  )
}

export default CollectionView
