import BookCard, { type BookCardProps } from './BookCard.jsx'
import EmptyState from '../ui/EmptyState.jsx'
import type { Book } from '../../types.js'

interface BookGridProps extends Omit<BookCardProps, 'book'> {
  books: Book[]
}

function BookGrid({ books, ...cardProps }: BookGridProps) {
  if (!books.length) {
    return (
      <EmptyState
        title="Nothing on this shelf yet"
        message="Try a different shelf or search for a title you already love."
      />
    )
  }

  return (
    <div className="bookGrid">
      {books.map((book) => (
        <BookCard key={book.id} book={book} {...cardProps} />
      ))}
    </div>
  )
}

export default BookGrid
