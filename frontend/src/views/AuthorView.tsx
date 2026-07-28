import { BookOpen, Tag, Star, ChevronRight } from 'lucide-react'
import BookCover from '../components/BookCover.jsx'
import useAuthorBooks from '../hooks/useAuthorBooks.js'
import { useNavigation } from '../context/NavigationContext.jsx'
import type { Book } from '../types.js'

interface AuthorViewProps {
  author: string
}

function AuthorView({ author }: AuthorViewProps) {
  const { books, loading, error } = useAuthorBooks(author)
  const { onOpen } = useNavigation()
  const heroBook = books[0] || null

  const genreCount = new Set(
    books.flatMap((book) => (book.genres.length ? book.genres : book.genre ? [book.genre] : []))
  ).size

  const ratedBooks = books.filter((book) => book.rating > 0 && book.ratingCount > 0)
  const avgRating = ratedBooks.length
    ? ratedBooks.reduce((sum, book) => sum + book.rating, 0) / ratedBooks.length
    : null

  const topRated = [...ratedBooks]
    .sort((a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount)
    .slice(0, 3)

  return (
    <div className="stack authorPage">
      <section className="authorHeroPanel paperGrain">
        <div className="finishedDialogTop authorDialogTop">
          <div className="finishedCoverColumn">
            <div className="finishedCoverWrap">
              {heroBook ? (
                <BookCover book={heroBook} glow />
              ) : (
                <div className="authorCoverFallback">
                  <span>{author ? author.charAt(0).toUpperCase() : '?'}</span>
                </div>
              )}
            </div>
          </div>

          <div className="finishedCopy">
            <div className="finishedHeader">
              <div>
                <h2>{author || 'Author'}</h2>
                <p>Books we have by this author, including co-written titles.</p>
              </div>
            </div>

            <p className="authorSummary">
              This page gathers every matching title from the catalog and gives you a clean shelf just like the finished-books view.
            </p>

            <div className="authorStats">
              <span className="authorStat">
                <BookOpen />
                <span>{books.length} {books.length === 1 ? 'book' : 'books'}</span>
              </span>
              {genreCount > 0 && (
                <span className="authorStat">
                  <Tag />
                  <span>{genreCount} {genreCount === 1 ? 'genre' : 'genres'}</span>
                </span>
              )}
              {avgRating !== null && (
                <span className="authorStat">
                  <Star />
                  <span>{avgRating.toFixed(1)} rating</span>
                </span>
              )}
            </div>

            {topRated.length > 1 && (
              <div className="authorNotable">
                <p className="authorNotableLabel">Highest rated</p>
                <ul className="authorNotableList">
                  {topRated.map((book) => (
                    <li key={book.id}>
                      <span className="authorNotableTitle">{book.title}</span>
                      <span className="authorNotableRating">{book.rating.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </section>

      {loading ? (
        <div className="emptyState">
          <p>Loading author books…</p>
        </div>
      ) : error ? (
        <div className="emptyState">
          <h2>Could not load author</h2>
          <p>{error}</p>
        </div>
      ) : books.length > 0 ? (
        <section className="authorBooksSection">
          <div className="shelfHeader">
            <div>
              <h2>All books</h2>
              <p>Every title in the catalog matched to this author.</p>
            </div>
          </div>
          <ul className="authorBookList">
            {books.map((book) => (
              <AuthorBookRow key={book.id} book={book} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ) : (
        <div className="emptyState">
          <h2>No books found</h2>
          <p>We couldn't find any titles in the catalog for this author.</p>
        </div>
      )}
    </div>
  )
}

interface AuthorBookRowProps {
  book: Book
  onOpen: (book: Book) => void
}

function AuthorBookRow({ book, onOpen }: AuthorBookRowProps) {
  const meta = (book.genres.length ? book.genres : book.genre ? [book.genre] : []).join(' · ')

  return (
    <li>
      <button type="button" className="authorBookRow" onClick={() => onOpen(book)}>
        <div className="authorBookRowCover">
          <BookCover book={book} />
        </div>
        <div className="authorBookRowCopy">
          <strong>{book.title}</strong>
          {meta ? <span>{meta}</span> : null}
        </div>
        <span className="authorBookRowRating">
          {book.rating > 0 ? (
            <>
              <Star fill="currentColor" />
              <span>{book.rating.toFixed(1)}</span>
            </>
          ) : null}
        </span>
        <ChevronRight className="authorBookRowChevron" />
      </button>
    </li>
  )
}

export default AuthorView
