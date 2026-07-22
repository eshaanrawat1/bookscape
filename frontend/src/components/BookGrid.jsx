import BookCard from './BookCard.jsx'

function BookGrid({ books, onOpen, onOpenAuthor, showRemoveButton = false, removeLabel = '', onRemove }) {
  if (!books.length) {
    return (
      <div className="emptyState">
        <h2>Nothing on this shelf yet</h2>
        <p>Try a different shelf or search for a title you already love.</p>
      </div>
    )
  }

  return (
    <div className="bookGrid">
      {books.map((book) => (
        <BookCard
          key={book.id}
          book={book}
          onOpen={onOpen}
          onOpenAuthor={onOpenAuthor}
          showRemoveButton={showRemoveButton}
          removeLabel={removeLabel}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}

export default BookGrid
