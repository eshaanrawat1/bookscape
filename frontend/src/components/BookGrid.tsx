import BookCard from './BookCard.jsx'
import type { Book } from '../types.js'

interface BookGridProps {
  books: Book[]
  showRemoveButton?: boolean
  removeLabel?: string
  onRemove?: (bookId: string) => void
}

function BookGrid({ books, showRemoveButton = false, removeLabel = '', onRemove }: BookGridProps) {
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
          showRemoveButton={showRemoveButton}
          removeLabel={removeLabel}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}

export default BookGrid
