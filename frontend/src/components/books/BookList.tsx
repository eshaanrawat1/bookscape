import type { ReactNode } from 'react'
import { ChevronRight, Star } from 'lucide-react'
import BookCover from './BookCover.jsx'
import { useNavigation } from '../../context/NavigationContext.jsx'
import type { BookProps } from '../../types.js'

interface BookListProps {
  title: string
  caption: string
  children: ReactNode
}

function BookList({ title, caption, children }: BookListProps) {
  return (
    <section className="authorBooksSection">
      <div className="shelfHeader">
        <h2>{title}</h2>
        <p className="authorBooksCaption">{caption}</p>
      </div>
      <ul className="authorBookList">{children}</ul>
    </section>
  )
}

interface BookListRowProps extends BookProps {
  subtitle?: string
  className?: string
  // Columns either side of the cover-and-title block.
  leading?: ReactNode
  trailing?: ReactNode
}

function BookListRow({ book, subtitle, className, leading, trailing }: BookListRowProps) {
  const { onOpen } = useNavigation()

  return (
    <li>
      <button
        type="button"
        className={['authorBookRow', className].filter(Boolean).join(' ')}
        onClick={() => onOpen(book)}
      >
        {leading}
        <div className="authorBookRowCover">
          <BookCover book={book} />
        </div>
        <div className="authorBookRowCopy">
          <strong>{book.title}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        {trailing}
        <span className="authorBookRowRating">
          {book.avg_rating > 0 ? (
            <>
              <Star fill="currentColor" />
              <span>{book.avg_rating.toFixed(2)}</span>
            </>
          ) : null}
        </span>
        <ChevronRight className="authorBookRowChevron" />
      </button>
    </li>
  )
}

export { BookList, BookListRow }
