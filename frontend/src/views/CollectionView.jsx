import BookGrid from '../components/BookGrid.jsx'

function CollectionView({ activeCollection, booksByIds, onOpen, onOpenAuthor, onRemoveFromCollection }) {
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
        onOpen={onOpen}
        onOpenAuthor={onOpenAuthor}
        showRemoveButton
        removeLabel={activeCollection.name}
        onRemove={(bookId) => onRemoveFromCollection(activeCollection.name, bookId)}
      />
    </div>
  )
}

export default CollectionView
