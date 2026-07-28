import { X } from 'lucide-react'
import BookCover from './BookCover.jsx'
import Progress from './Progress.jsx'
import { useNavigation } from '../context/NavigationContext.jsx'

function BookCard({ book, showRemoveButton = false, removeLabel = '', onRemove }) {
  const { onOpen, onOpenAuthor } = useNavigation()
  const card = (
    <div className="bookCard">
      <button type="button" className="bookCardButton" onClick={() => onOpen(book)}>
        <div className="coverWrap">
          <BookCover book={book} />
          {book.progress > 0 && book.progress < 100 && (
            <div className="coverProgress">
              <Progress value={book.progress} />
            </div>
          )}
        </div>
        <strong>{book.title}</strong>
      </button>
      {book.author ? (
        <button
          type="button"
          className="bookAuthorButton"
          onClick={(event) => {
            event.stopPropagation()
            onOpenAuthor?.(book.author)
          }}
          disabled={!onOpenAuthor}
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
      {showRemoveButton && onRemove && (
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
      )}
      {card}
    </div>
  )
}

export default BookCard
