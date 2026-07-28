import { BookOpen, Tag, Star, ChevronRight, BookText } from 'lucide-react'
import BookCover from '../components/BookCover.jsx'
import useAuthorBooks from '../hooks/useAuthorBooks.js'
import { useNavigation } from '../context/NavigationContext.jsx'
import type { Book } from '../types.js'

interface AuthorViewProps {
  author: string
}

const BLURB_LIMIT = 260

function truncateBlurb(text: string, limit = BLURB_LIMIT): { text: string; isTruncated: boolean } {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return { text: trimmed, isTruncated: false }
  const clipped = trimmed.slice(0, limit)
  const lastSpace = clipped.lastIndexOf(' ')
  const safe = (lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped).trim()
  return { text: `${safe}…`, isTruncated: true }
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

  const featuredBlurb = heroBook?.blurb ? truncateBlurb(heroBook.blurb) : null

  return (
    <div className="stack authorPage">
      <section className="authorHeroPanel">
        <div className="finishedDialogTop authorDialogTop">
          <div className="finishedCoverColumn">
            <div className="finishedCoverWrap authorHeroFrame">
              {heroBook ? (
                <BookCover book={heroBook} glow />
              ) : (
                <div className="authorCoverFallback">
                  <span>{author ? author.charAt(0).toUpperCase() : '?'}</span>
                </div>
              )}
            </div>
            {heroBook && <p className="authorHeroCaption">Featured</p>}
          </div>

          <div className="finishedCopy">
            <div className="finishedHeader">
              <div>
                <h2>{author || 'Author'}</h2>
              </div>
            </div>

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
                  <span>{avgRating.toFixed(1)} average</span>
                </span>
              )}
            </div>

            <p className="authorSummary">
              Books we have by this author, including co-written titles. This page gathers every matching title from the catalog and gives you a clean shelf just like the finished-books view.
            </p>

            {featuredBlurb && heroBook && (
              <div className="authorFeatured">
                <p className="authorFeaturedLabel">
                  <BookText />
                  <span>About {heroBook.title}</span>
                </p>
                <p className="authorFeaturedBlurb">
                  {featuredBlurb.text}
                  {featuredBlurb.isTruncated && (
                    <button type="button" className="authorFeaturedReadMore" onClick={() => onOpen(heroBook)}>
                      Read more
                    </button>
                  )}
                </p>
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
            <h2>All books</h2>
            <p className="authorBooksCaption">Every title matched to this author</p>
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
