import { X } from 'lucide-react'
import BookCover from './BookCover.jsx'
import CoverProgress from './CoverProgress.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'
import type { Book } from '../types.js'

interface BookCardProps {
  book: Book
  showRemoveButton?: boolean
  removeLabel?: string
  onRemove?: (bookId: string) => void
}

function BookCard({ book, showRemoveButton = false, removeLabel = '', onRemove }: BookCardProps) {
  const { onOpen, onOpenAuthor } = useNavigation()
  const card = (
    <div className="bookCard">
      <button type="button" className="bookCardButton" onClick={() => onOpen(book)}>
        <div className="coverWrap">
          <BookCover book={book} />
          <CoverProgress book={book} />
        </div>
        <strong>{book.title}</strong>
      </button>
      {book.author ? (
        <button
          type="button"
          className="bookAuthorButton"
          onClick={(event) => {
            event.stopPropagation()
            onOpenAuthor(book.author)
          }}
        >
          {book.author}
        </button>
      ) : (
        <span className="bookAuthorButton isEmpty" aria-hidden="true" />
      )}
    </div>
  )

  if (!showRemoveButton || !onRemove) return card

  return (
    <div className="bookCardWrap">
      <button
        type="button"
        className="collectionRemoveButton"
        aria-label={`Remove ${book.title} from ${removeLabel || 'this collection'}`}
        title={`Remove from ${removeLabel || 'collection'}`}
        onClick={(event) => {
          event.stopPropagation()
          onRemove(book.id)
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <X />
      </button>
      {card}
    </div>
  )
}

export default BookCard
