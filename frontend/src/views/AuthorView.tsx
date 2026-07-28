import { useEffect, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, Star, MessageSquareText, FileText } from 'lucide-react'
import { buildHeroGlow } from '../color.js'
import { formatCompactNumber } from '../utils.js'
import BookCover from '../components/BookCover.jsx'
import useAuthorBooks from '../hooks/useAuthorBooks.js'
import { useNavigation } from '../context/NavigationContext.jsx'
import type { Book } from '../types.js'

interface AuthorViewProps {
  author: string
}

interface AuthorHeroProps {
  books: Book[]
  onOpen: (book: Book) => void
}

function AuthorHero({ books, onOpen }: AuthorHeroProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')

  const safeIndex = currentIndex >= books.length ? 0 : currentIndex

  useEffect(() => {
    if (books.length < 2) return
    const neighborCovers = [
      books[(safeIndex + 1) % books.length]?.cover,
      books[(safeIndex - 1 + books.length) % books.length]?.cover,
    ]
    neighborCovers.forEach((src) => {
      if (!src) return
      const preload = new Image()
      preload.src = src
    })
  }, [books, safeIndex])

  const book = books[safeIndex]
  if (!book) return null

  const nextBook = () => {
    setDirection('next')
    setCurrentIndex((i) => (i + 1) % books.length)
  }
  const prevBook = () => {
    setDirection('prev')
    setCurrentIndex((i) => (i - 1 + books.length) % books.length)
  }

  const heroGlowColor = buildHeroGlow(book.color || `hsl(${book.tint})`)

  return (
    <section className="heroCard paperGrain">
      <div className="heroGlow" style={{ '--hero-glow': heroGlowColor } as CSSProperties} />
      {books.length > 1 && (
        <div className="carouselControls">
          <button className="carouselButton" onClick={prevBook} aria-label="Previous book">
            <ChevronLeft />
          </button>
          <button className="carouselButton" onClick={nextBook} aria-label="Next book">
            <ChevronRight />
          </button>
        </div>
      )}
      <div className={`heroInner heroSlide-${direction}`} key={book.id}>
        <button className="heroCover" onClick={() => onOpen(book)}>
          <BookCover book={book} glow />
        </button>
        <div className="heroCopy">
          <h2>{book.title}</h2>
          <p className="bookMeta">{book.author} · {book.genre}</p>
          <p className="heroBlurb">{book.blurb}</p>
          <div className="dialogStatsRow">
            {book.rating > 0 && (
              <span className="dialogStatItem">
                <Star />
                <span>{book.rating.toFixed(1)}{book.ratingCount > 0 ? ` (${formatCompactNumber(book.ratingCount)})` : ''}</span>
              </span>
            )}
            {book.reviewCount > 0 && (
              <span className="dialogStatItem">
                <MessageSquareText />
                <span>{formatCompactNumber(book.reviewCount)}</span>
              </span>
            )}
            {book.pages > 0 && (
              <span className="dialogStatItem">
                <FileText />
                <span>{formatCompactNumber(book.pages)} pages</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function AuthorView({ author }: AuthorViewProps) {
  const { books, loading, error } = useAuthorBooks(author)
  const { onOpen } = useNavigation()

  return (
    <div className="stack authorPage">
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
        <>
          <AuthorHero key={author} books={books} onOpen={onOpen} />
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
        </>
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
